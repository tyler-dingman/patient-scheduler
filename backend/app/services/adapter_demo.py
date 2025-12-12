from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import List, Literal

from .adapter_base import AvailabilitySlot, SchedulingAdapter

VisitMode = Literal["in_person", "virtual"]


class DemoAdapter(SchedulingAdapter):
    """
    Deterministic availability generator.
    - Weekdays only
    - 30-minute slots
    - 9:00–16:30 local time (last start at 16:30)
    """

    def generate_availability(self, provider_ids: List[str], start_date: date, days: int, mode: VisitMode) -> List[AvailabilitySlot]:
        slots: List[AvailabilitySlot] = []

        for day_offset in range(days):
            d = start_date + timedelta(days=day_offset)
            # 0=Mon ... 6=Sun
            if d.weekday() >= 5:
                continue

            start_t = time(9, 0)
            end_t = time(17, 0)  # end boundary
            cursor = datetime.combine(d, start_t)
            end_boundary = datetime.combine(d, end_t)

            while cursor < end_boundary:
                slot_end = cursor + timedelta(minutes=30)
                if slot_end <= end_boundary:
                    for pid in provider_ids:
                        slots.append(AvailabilitySlot(
                            provider_id=pid,
                            start=cursor,
                            end=slot_end,
                            mode=mode,
                        ))
                cursor = slot_end

        return slots
