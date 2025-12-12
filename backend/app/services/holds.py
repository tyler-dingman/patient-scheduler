from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional
from sqlmodel import Session, select
from ..models import SlotHold, Appointment

HOLD_TTL_MINUTES = 5

def cleanup_expired_holds(session: Session) -> int:
    now = datetime.utcnow()
    stmt = select(SlotHold).where(SlotHold.expires_at < now, SlotHold.consumed_at.is_(None))
    holds = session.exec(stmt).all()
    for h in holds:
        session.delete(h)
    session.commit()
    return len(holds)

def create_hold(
    session: Session,
    provider_id: str,
    location_id: str,
    start: datetime,
    end: datetime,
    mode: str,
    visit_reason_code: str,
) -> SlotHold:
    cleanup_expired_holds(session)

    # prevent holding if already booked
    booked = session.exec(
        select(Appointment).where(
            Appointment.provider_id == provider_id,
            Appointment.start == start,
            Appointment.mode == mode,
            Appointment.status == "confirmed",
        )
    ).first()
    if booked:
        raise ValueError("Slot already booked")

    # prevent multiple active holds for same slot
    active_hold = session.exec(
        select(SlotHold).where(
            SlotHold.provider_id == provider_id,
            SlotHold.start == start,
            SlotHold.mode == mode,
            SlotHold.consumed_at.is_(None),
            SlotHold.expires_at > datetime.utcnow(),
        )
    ).first()
    if active_hold:
        raise ValueError("Slot is currently on hold")

    hold = SlotHold(
        id="hold_" + uuid.uuid4().hex[:12],
        provider_id=provider_id,
        location_id=location_id,
        start=start,
        end=end,
        mode=mode,  # type: ignore
        visit_reason_code=visit_reason_code,
        expires_at=datetime.utcnow() + timedelta(minutes=HOLD_TTL_MINUTES),
    )
    session.add(hold)
    session.commit()
    session.refresh(hold)
    return hold

def consume_hold(session: Session, hold_id: str) -> SlotHold:
    cleanup_expired_holds(session)
    hold = session.get(SlotHold, hold_id)
    if not hold:
        raise KeyError("Hold not found")
    if hold.consumed_at is not None:
        raise ValueError("Hold already used")
    if hold.expires_at <= datetime.utcnow():
        raise ValueError("Hold expired")
    hold.consumed_at = datetime.utcnow()
    session.add(hold)
    session.commit()
    session.refresh(hold)
    return hold
