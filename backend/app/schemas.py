from __future__ import annotations

from datetime import datetime, date
from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field, EmailStr

ProviderType = Literal["primary_care", "urgent_care", "dermatology", "orthopedics"]
VisitMode = Literal["in_person", "virtual"]


class SearchIntentRequest(BaseModel):
    session_id: str = Field(..., min_length=3, max_length=120)
    message: str = Field(..., min_length=1, max_length=2000)
    zip: Optional[str] = None
    mode_preference: Optional[VisitMode] = None


class SearchIntentResponse(BaseModel):
    escalate: bool
    safety_message: Optional[str] = None
    not_medical_advice: str
    visit_reason_code: Optional[str] = None
    visit_reason_label: Optional[str] = None
    recommended_provider_type: Optional[ProviderType] = None
    confidence: Optional[str] = None
    follow_up_questions: List[str] = []


class CareOption(BaseModel):
    provider_type: ProviderType
    label: str
    suggested: bool = False


class CareOptionsResponse(BaseModel):
    options: List[CareOption]


class AvailabilityResponseSlot(BaseModel):
    provider_id: str
    provider_name: str
    location_id: str
    location_name: str
    start: datetime
    end: datetime
    mode: VisitMode


class AvailabilityResponse(BaseModel):
    slots: List[AvailabilityResponseSlot]


class CreateHoldRequest(BaseModel):
    session_id: str
    provider_id: str
    start: datetime
    mode: VisitMode
    visit_reason_code: str


class CreateHoldResponse(BaseModel):
    hold_id: str
    expires_at: datetime


class BookAppointmentRequest(BaseModel):
    session_id: str
    hold_id: str

    patient_first_name: str = Field(..., min_length=1, max_length=60)
    patient_last_name: str = Field(..., min_length=1, max_length=60)
    patient_dob: date
    patient_phone: str = Field(..., min_length=7, max_length=30)
    patient_email: Optional[EmailStr] = None
    notes: Optional[str] = Field(None, max_length=1000)


class BookAppointmentResponse(BaseModel):
    appointment_id: str
    provider_name: str
    location_name: str
    start: datetime
    end: datetime
    mode: VisitMode
    status: Literal["confirmed"]


class LogEventRequest(BaseModel):
    event_type: str
    payload: Dict[str, Any]


class LogEventResponse(BaseModel):
    status: Literal["ok"]
