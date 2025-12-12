from __future__ import annotations

import re
from typing import Dict, Any

# Very small, deterministic "intent mapping" (no external APIs)
# Output shape is used by app/main.py

_RULES = [
    # urgent care / respiratory
    (re.compile(r"\b(sore throat|strep|cough|fever|flu|cold|sinus|ear pain)\b", re.I),
     {"visit_reason_code": "URTI_SORE_THROAT", "visit_reason_label": "upper respiratory symptoms", "recommended_provider_type": "urgent_care", "confidence": "high"}),

    # dermatology
    (re.compile(r"\b(rash|hives|eczema|acne|skin|mole)\b", re.I),
     {"visit_reason_code": "DERM_RASH", "visit_reason_label": "skin concern", "recommended_provider_type": "dermatology", "confidence": "high"}),

    # orthopedics / injury
    (re.compile(r"\b(knee|shoulder|ankle|wrist|sprain|fracture|bone|joint|back pain)\b", re.I),
     {"visit_reason_code": "MSK_PAIN", "visit_reason_label": "musculoskeletal pain/injury", "recommended_provider_type": "orthopedics", "confidence": "medium"}),

    # routine primary care
    (re.compile(r"\b(checkup|physical|annual|wellness|establish care|new patient)\b", re.I),
     {"visit_reason_code": "PCP_ROUTINE", "visit_reason_label": "routine primary care", "recommended_provider_type": "primary_care", "confidence": "high"}),
]


def map_to_intent(message: str) -> Dict[str, Any]:
    text = (message or "").strip()
    for rx, payload in _RULES:
        if rx.search(text):
            return dict(payload)

    # fallback
    return {
        "visit_reason_code": "GENERIC_TRIAGE",
        "visit_reason_label": "a health concern",
        "recommended_provider_type": "primary_care",
        "confidence": "low",
    }
