from __future__ import annotations

from datetime import date, timedelta
import uuid

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .db import create_db_and_tables, get_session, engine
from .models import Provider, Location, Appointment
from .schemas import (
    SearchIntentRequest, SearchIntentResponse,
    CareOptionsResponse, CareOption,
    AvailabilityResponse, AvailabilityResponseSlot,
    CreateHoldRequest, CreateHoldResponse,
    BookAppointmentRequest, BookAppointmentResponse,
)
from .services.triage import detect_red_flags
from .services.intent import map_to_intent
from .services.adapter_demo import DemoAdapter
from .services.audit import log_event, log_recommendation
from .services.holds import create_hold, consume_hold


app = FastAPI(title="Conversational Patient Scheduling API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

adapter = DemoAdapter()


@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    with Session(engine) as s:
        if not s.exec(select(Location)).first():
            s.add(Location(
                id="loc_1",
                name="Optum Clinic - Downtown",
                address="123 Main St",
                city="Chicago",
                state="IL",
                zip="60601",
                timezone="America/Chicago",
            ))
            s.add(Location(
                id="loc_2",
                name="Optum Clinic - North",
                address="500 North Ave",
                city="Chicago",
                state="IL",
                zip="60640",
                timezone="America/Chicago",
            ))
            s.commit()

        if not s.exec(select(Provider)).first():
            s.add(Provider(id="prov_1", name="Dr. Maya Patel", provider_type="primary_care", location_id="loc_1", accepts_virtual=True))
            s.add(Provider(id="prov_2", name="Dr. James Lee", provider_type="urgent_care", location_id="loc_1", accepts_virtual=True))
            s.add(Provider(id="prov_3", name="Dr. Sofia Kim", provider_type="dermatology", location_id="loc_2", accepts_virtual=True))
            s.add(Provider(id="prov_4", name="Dr. Ethan Ross", provider_type="orthopedics", location_id="loc_2", accepts_virtual=False))
            s.commit()


@app.post("/api/search-intent", response_model=SearchIntentResponse)
def search_intent(req: SearchIntentRequest, session: Session = Depends(get_session)):
    log_event(session, req.session_id, "user_message", {"text": req.message})

    flag = detect_red_flags(req.message)
    if flag:
        msg = f"{flag} If you think this may be an emergency, call 911 or go to the nearest ER."
        log_event(session, req.session_id, "escalated", {"reason": "red_flag", "message": msg})
        return SearchIntentResponse(
            escalate=True,
            safety_message=msg,
            not_medical_advice="This tool provides scheduling assistance only and is not medical advice.",
            follow_up_questions=[],
        )

    intent = map_to_intent(req.message)
    confidence = intent["confidence"]

    follow_ups = []
    if confidence == "low":
        follow_ups = [
            "What symptom or concern is most important today?",
            "Is this urgent (today/soon) or routine?",
            "Do you prefer in-person or virtual?",
        ]

    rationale = f"Mapped symptoms to visit_reason_code={intent['visit_reason_code']} and suggested {intent['recommended_provider_type']}."
    log_recommendation(
        session,
        req.session_id,
        intent["recommended_provider_type"],
        intent["visit_reason_code"],
        rationale=rationale,
        confidence=confidence,
    )

    assistant_text = f"I can help you schedule for {intent['visit_reason_label']}. Choose a care type and then pick a time."
    log_event(session, req.session_id, "assistant_message", {"text": assistant_text})

    return SearchIntentResponse(
        escalate=False,
        not_medical_advice="This tool provides scheduling assistance only and is not medical advice.",
        visit_reason_code=intent["visit_reason_code"],
        visit_reason_label=intent["visit_reason_label"],
        recommended_provider_type=intent["recommended_provider_type"],  # type: ignore
        confidence=confidence,
        follow_up_questions=follow_ups,
    )


@app.get("/api/care-options", response_model=CareOptionsResponse)
def care_options(visit_reason_code: str, recommended_provider_type: str):
    options = [
        CareOption(provider_type="urgent_care", label="Urgent Care (same-day / acute)", suggested=(recommended_provider_type == "urgent_care")),
        CareOption(provider_type="primary_care", label="Primary Care (ongoing / general)", suggested=(recommended_provider_type == "primary_care")),
        CareOption(provider_type="dermatology", label="Dermatology (skin)", suggested=(recommended_provider_type == "dermatology")),
        CareOption(provider_type="orthopedics", label="Orthopedics (bones/joints)", suggested=(recommended_provider_type == "orthopedics")),
    ]
    if visit_reason_code == "GENERIC_TRIAGE":
        for o in options:
            o.suggested = (o.provider_type == "primary_care")
    return CareOptionsResponse(options=options)


@app.get("/api/availability", response_model=AvailabilityResponse)
def availability(
    provider_type: str,
    start_date: date,
    days: int = 7,
    mode: str = "in_person",
    visit_reason_code: str = "GENERIC_TRIAGE",
    session: Session = Depends(get_session),
):
    providers = session.exec(
        select(Provider).where(Provider.provider_type == provider_type)
    ).all()

    # IMPORTANT: always return a valid response model (never None)
    if not providers:
        return AvailabilityResponse(slots=[])

    provider_ids = [p.id for p in providers]

    slots = adapter.generate_availability(provider_ids, start_date, days, mode)  # type: ignore

    booked = session.exec(
        select(Appointment).where(
            Appointment.provider_id.in_(provider_ids),
            Appointment.status == "confirmed",
            Appointment.mode == mode,  # type: ignore
        )
    ).all()
    booked_keys = {(b.provider_id, b.start, b.mode) for b in booked}

    locs = {l.id: l for l in session.exec(select(Location)).all()}
    provider_by_id = {p.id: p for p in providers}

    out: list[AvailabilityResponseSlot] = []
    for s in slots:
        if (s.provider_id, s.start, s.mode) in booked_keys:
            continue

        p = provider_by_id.get(s.provider_id)
        if not p:
            continue
        loc = locs.get(p.location_id)
        if not loc:
            continue

        out.append(
            AvailabilityResponseSlot(
                provider_id=p.id,
                provider_name=p.name,
                location_id=p.location_id,
                location_name=loc.name,
                start=s.start,
                end=s.end,
                mode=s.mode,
            )
        )

    return AvailabilityResponse(slots=out)


@app.post("/api/holds", response_model=CreateHoldResponse)
def hold_slot(
    req: CreateHoldRequest,
    session: Session = Depends(get_session),
):
    provider = session.get(Provider, req.provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        hold = create_hold(
            session=session,
            provider_id=req.provider_id,
            location_id=provider.location_id,
            start=req.start,
            end=req.start + timedelta(minutes=30),
            mode=req.mode,
            visit_reason_code=req.visit_reason_code,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    log_event(
        session,
        req.session_id,
        "hold_created",
        {"hold_id": hold.id, "provider_id": hold.provider_id, "start": hold.start.isoformat()},
    )

    return CreateHoldResponse(
        hold_id=hold.id,
        expires_at=hold.expires_at,
    )


@app.post("/api/appointments", response_model=BookAppointmentResponse)
def book(
    req: BookAppointmentRequest,
    session: Session = Depends(get_session),
):
    try:
        hold = consume_hold(session, req.hold_id)
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    provider = session.get(Provider, hold.provider_id)
    location = session.get(Location, hold.location_id)
    if not provider or not location:
        raise HTTPException(status_code=500, detail="Provider/location missing for hold")

    appt = Appointment(
        id="appt_" + uuid.uuid4().hex[:12],
        provider_id=hold.provider_id,
        location_id=hold.location_id,
        start=hold.start,
        end=hold.end,
        mode=hold.mode,
        visit_reason_code=hold.visit_reason_code,
        patient_first_name=req.patient_first_name,
        patient_last_name=req.patient_last_name,
        patient_dob=req.patient_dob,
        patient_phone=req.patient_phone,
        patient_email=req.patient_email,
        notes=req.notes,
        status="confirmed",
    )
    session.add(appt)
    session.commit()
    session.refresh(appt)

    log_event(
        session,
        req.session_id,
        "appointment_booked",
        {"appointment_id": appt.id},
    )

    return BookAppointmentResponse(
        appointment_id=appt.id,
        provider_name=provider.name,
        location_name=location.name,
        start=appt.start,
        end=appt.end,
        mode=appt.mode,
        status="confirmed",
    )
