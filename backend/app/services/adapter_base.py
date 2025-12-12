from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, date
from typing import List, Protocol, Literal

VisitMode = Literal["in_person", "virtual"]


@dataclass(frozen=True)
class AvailabilitySlot:
    provider_id: str
    start: datetime
    end: datetime
    mode: VisitMode


class SchedulingAdapter(Protocol):
    def generate_availability(self, provider_ids: List[str], start_date: date, days: int, mode: VisitMode) -> List[AvailabilitySlot]:
        ...
