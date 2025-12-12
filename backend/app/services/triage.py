import re
from typing import Optional

RED_FLAG_PATTERNS = [
    (re.compile(r"\b(chest pain|pressure in chest|tightness in chest)\b", re.I),
     "Chest pain can be an emergency."),
    (re.compile(r"\b(trouble breathing|shortness of breath)\b", re.I),
     "Trouble breathing can be an emergency."),
    (re.compile(r"\b(face droop|slurred speech|weakness on one side|stroke)\b", re.I),
     "Possible stroke symptoms can be an emergency."),
]

def detect_red_flags(text: str) -> Optional[str]:
    for rx, msg in RED_FLAG_PATTERNS:
        if rx.search(text or ""):
            return msg
    return None
