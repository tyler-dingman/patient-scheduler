from datetime import date
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))
from app.main import app


def test_availability_defaults_to_today_when_missing_start_date():
    with TestClient(app) as client:
        response = client.get(
            "/api/availability",
            params={
                "provider_type": "primary_care",
                "days": 1,
                "mode": "in_person",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "slots" in data
        assert isinstance(data["slots"], list)


def test_availability_slots_are_sorted_by_start_then_provider():
    # Use a known weekday to ensure deterministic slot generation
    with TestClient(app) as client:
        response = client.get(
            "/api/availability",
            params={
                "provider_type": "primary_care",
                "start_date": date(2024, 9, 2),  # Monday
                "days": 1,
                "mode": "in_person",
            },
        )

        assert response.status_code == 200
        slots = response.json()["slots"]
        assert len(slots) >= 2

        sorted_slots = sorted(slots, key=lambda s: (s["start"], s["provider_id"]))
        assert slots == sorted_slots
