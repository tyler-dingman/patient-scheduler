from __future__ import annotations

import json
import uuid
from typing import Any, Dict

from sqlmodel import Session

from ..models import ConversationEvent, RecommendationAudit, ProviderType


def log_event(session: Session, session_id: str, event_type: str, payload: Dict[str, Any]) -> None:
    """
    Append-only audit log for conversation + user actions.
    Stored as JSON string for flexibility.
    """
    ev = ConversationEvent(
        id="evt_" + uuid.uuid4().hex[:12],
        session_id=session_id,
        event_type=event_type,
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    session.add(ev)
    session.commit()


def log_recommendation(
    session: Session,
    session_id: str,
    recommended_provider_type: str | ProviderType,
    visit_reason_code: str,
    rationale: str,
    confidence: str,
) -> None:
    """
    Audit record for clinical-routing recommendation (non-clinical, deterministic mapping here).
    """
    # Allow passing either raw string or enum
    rpt = recommended_provider_type.value if isinstance(recommended_provider_type, ProviderType) else recommended_provider_type

    rec = RecommendationAudit(
        id="rec_" + uuid.uuid4().hex[:12],
        session_id=session_id,
        recommended_provider_type=rpt,  # SQLModel will coerce to enum
        visit_reason_code=visit_reason_code,
        rationale=rationale,
        confidence=confidence,
    )
    session.add(rec)
    session.commit()
