from __future__ import annotations

from datetime import datetime, date
from enum import Enum
from typing import Optional
from sqlmodel import SQLModel, Field, Index


class ProviderType(str, Enum):
    primary_care = "primary_care"
    urgent_care = "urgent_care"
    dermatology = "dermatology"
    orthopedics = "orthopedics"
    cardiology = "cardiology"


class VisitMode(str, Enum):
    in_person = "in_person"
    virtual = "virtual"


class Location(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    address: str
    city: str
    state: str
    zip: str
    timezone: str = "America/Chicago"


class Provider(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    provider_type: ProviderType
    location_id: str = Field(foreign_key="location.id")
    accepts_virtual: bool = True


class Appointment(SQLModel, table=True):
    id: str = Field(primary_key=True)
    provider_id: str = Field(foreign_key="provider.id")
    location_id: str = Field(foreign_key="location.id")
    start: datetime
    end: datetime
    mode: VisitMode
    visit_reason_code: str

    patient_first_name: str
    patient_last_name: str
    patient_dob: date
    patient_phone: str
    patient_email: Optional[str] = None
    notes: Optional[str] = None

    status: str = "confirmed"
    created_at: datetime = Field(default_factory=datetime.utcnow)


Index("idx_appt_provider_start_mode", Appointment.provider_id, Appointment.start, Appointment.mode)


class SlotHold(SQLModel, table=True):
    id: str = Field(primary_key=True)
    provider_id: str = Field(foreign_key="provider.id")
    location_id: str = Field(foreign_key="location.id")
    start: datetime
    end: datetime
    mode: VisitMode
    visit_reason_code: str

    expires_at: datetime
    consumed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


Index("idx_hold_provider_start_mode", SlotHold.provider_id, SlotHold.start, SlotHold.mode)


class ConversationEvent(SQLModel, table=True):
    id: str = Field(primary_key=True)
    session_id: str
    event_type: str
    payload_json: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RecommendationAudit(SQLModel, table=True):
    id: str = Field(primary_key=True)
    session_id: str
    recommended_provider_type: ProviderType
    visit_reason_code: str
    rationale: str
    confidence: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
