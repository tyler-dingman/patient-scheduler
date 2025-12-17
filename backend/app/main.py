from __future__ import annotations

from datetime import date, datetime, timedelta
import difflib
import uuid

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .db import create_db_and_tables, get_session, engine, verify_connection
from .models import Appointment, Location, Provider, SchedulingAccess
from .schemas import (
    SearchIntentRequest, SearchIntentResponse,
    CareOptionsResponse, CareOption,
    AvailabilityResponse, AvailabilityResponseSlot,
    CreateHoldRequest, CreateHoldResponse,
    BookAppointmentRequest, BookAppointmentResponse,
    ProviderSummary, ProvidersResponse,
    ProviderSearchResponse,
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
    verify_connection()
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

        providers = [
            Provider(
                id="prov_1",
                name="Dr. Maya Patel",
                provider_type="primary_care",
                location_id="loc_1",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.open_scheduling,
            ),
            Provider(
                id="prov_2",
                name="Dr. James Lee",
                provider_type="urgent_care",
                location_id="loc_1",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_3",
                name="Dr. Sofia Kim",
                provider_type="dermatology",
                location_id="loc_2",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_4",
                name="Dr. Ethan Ross",
                provider_type="orthopedics",
                location_id="loc_2",
                accepts_virtual=False,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_5",
                name="Dr. Elena Garcia",
                provider_type="primary_care",
                location_id="loc_1",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.open_scheduling,
            ),
            Provider(
                id="prov_6",
                name="Dr. Marcus Chen",
                provider_type="primary_care",
                location_id="loc_2",
                accepts_virtual=False,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_7",
                name="Dr. Priya Nair",
                provider_type="cardiology",
                location_id="loc_1",
                accepts_virtual=False,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_8",
                name="Dr. Samuel Ortiz",
                provider_type="cardiology",
                location_id="loc_2",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_9",
                name="Dr. Hannah Schultz",
                provider_type="neurology",
                location_id="loc_1",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_10",
                name="Dr. Amir Rahman",
                provider_type="neurology",
                location_id="loc_2",
                accepts_virtual=False,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_11",
                name="Dr. John Smith",
                provider_type="primary_care",
                location_id="loc_1",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.open_scheduling,
            ),
            Provider(
                id="prov_12",
                name="Dr. Alicia Johnson",
                provider_type="primary_care",
                location_id="loc_2",
                accepts_virtual=True,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
            Provider(
                id="prov_13",
                name="Dr. Marcus Johnson",
                provider_type="orthopedics",
                location_id="loc_2",
                accepts_virtual=False,
                scheduling_access=SchedulingAccess.direct_scheduling,
            ),
        ]

        for provider in providers:
            if not s.get(Provider, provider.id):
                s.add(provider)

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
        CareOption(provider_type="cardiology", label="Cardiology (heart health)", suggested=(recommended_provider_type == "cardiology")),
        CareOption(provider_type="neurology", label="Neurology (brain & nerves)", suggested=(recommended_provider_type == "neurology")),
    ]
    if visit_reason_code == "GENERIC_TRIAGE":
        for o in options:
            o.suggested = (o.provider_type == "primary_care")
    return CareOptionsResponse(options=options)


def summarize_providers(
    providers: list[Provider],
    session: Session,
    mode: str | None,
    start: date,
    days: int,
) -> list[ProviderSummary]:
    if not providers:
        return []

    locs = {l.id: l for l in session.exec(select(Location)).all()}
    booked_rows = session.exec(
        select(Appointment).where(
            Appointment.provider_id.in_([p.id for p in providers]),
            Appointment.status == "confirmed",
        )
    ).all()
    booked = {(b.provider_id, b.start, b.mode) for b in booked_rows}

    summaries: list[tuple[datetime, ProviderSummary]] = []
    for p in providers:
        loc = locs.get(p.location_id)
        if not loc:
            continue

        mode_choices: list[str] = []
        if mode:
            mode_choices.append(mode)
        else:
            mode_choices.append("in_person")
            if p.accepts_virtual:
                mode_choices.append("virtual")

        candidates = []
        for m in mode_choices:
            slots = adapter.generate_availability([p.id], start, days, m)  # type: ignore[arg-type]
            for s in slots:
                if (p.id, s.start, s.mode) in booked:
                    continue
                candidates.append(s)

        next_slot = min(candidates, key=lambda s: s.start) if candidates else None
        availability_label = None
        if next_slot:
            readable_time = next_slot.start.strftime("%a %I:%M %p").lstrip("0")
            availability_label = f"Next: {readable_time} ({'Virtual' if next_slot.mode == 'virtual' else 'In person'})"

        next_slot_time = next_slot.start if next_slot else datetime.max

        summaries.append(
            (
                next_slot_time,
                ProviderSummary(
                    provider_id=p.id,
                    name=p.name,
                    provider_type=p.provider_type,
                    accepts_virtual=p.accepts_virtual,
                    scheduling_access=p.scheduling_access,
                    location_name=loc.name,
                    location_city=loc.city,
                    location_state=loc.state,
                    next_available_start=next_slot.start if next_slot else None,
                    next_available_mode=next_slot.mode if next_slot else None,
                    availability_label=availability_label,
                ),
            )
        )

    summaries.sort(key=lambda item: (item[0], item[1].name))

    return [s for _, s in summaries]


@app.get("/api/providers", response_model=ProvidersResponse)
def provider_directory(
    provider_type: str | None = None,
    limit: int = 5,
    mode: str | None = None,
    start_date: date | None = None,
    days: int = 14,
    session: Session = Depends(get_session),
):
    start = start_date or date.today()

    query = select(Provider)
    if provider_type:
        query = query.where(Provider.provider_type == provider_type)

    providers = session.exec(query).all()
    providers = providers[:limit]

    summaries = summarize_providers(providers, session, mode, start, days)

    return ProvidersResponse(providers=summaries)


@app.get("/api/provider-search", response_model=ProviderSearchResponse)
def provider_search(
    q: str,
    provider_type: str | None = None,
    limit: int = 5,
    mode: str | None = None,
    start_date: date | None = None,
    days: int = 14,
    session: Session = Depends(get_session),
):
    start = start_date or date.today()
    normalized_query = q.strip().lower()

    if not normalized_query:
        return ProviderSearchResponse(providers=[], suggestions=[])

    query = select(Provider)
    if provider_type:
        query = query.where(Provider.provider_type == provider_type)

    providers = session.exec(query).all()

    direct_matches = [
        p for p in providers if normalized_query in p.name.lower()
    ][:limit]

    if len(direct_matches) < limit:
        last_name_map = {p.id: p.name.split()[-1].lower() for p in providers}
        # Prefer prefix matches on last name for typeahead behavior
        last_name_candidates = [
            p for p in providers
            if last_name_map[p.id].startswith(normalized_query)
        ]

        if not last_name_candidates:
            close_last_names = set(
                difflib.get_close_matches(
                    normalized_query, list(last_name_map.values()), n=5, cutoff=0.6
                )
            )
            last_name_candidates = [
                p for p in providers if last_name_map[p.id] in close_last_names
            ]

        suggestion_pool = [p for p in last_name_candidates if p not in direct_matches]
        suggestions = suggestion_pool[: max(0, limit - len(direct_matches))]
    else:
        suggestions = []

    summaries = summarize_providers(direct_matches, session, mode, start, days)
    suggestion_summaries = summarize_providers(suggestions, session, mode, start, days)

    return ProviderSearchResponse(providers=summaries, suggestions=suggestion_summaries)


@app.get("/api/availability", response_model=AvailabilityResponse)
def availability(
    provider_type: str,
    start_date: date | None = None,
    days: int = 7,
    mode: str = "in_person",
    visit_reason_code: str = "GENERIC_TRIAGE",
    session: Session = Depends(get_session),
):
    start = start_date or date.today()

    providers = session.exec(
        select(Provider).where(Provider.provider_type == provider_type)
    ).all()

    # IMPORTANT: always return a valid response model (never None)
    if not providers:
        return AvailabilityResponse(slots=[])

    provider_ids = [p.id for p in providers]

    slots = adapter.generate_availability(provider_ids, start, days, mode)  # type: ignore

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

    out.sort(key=lambda s: (s.start, s.provider_id))

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
