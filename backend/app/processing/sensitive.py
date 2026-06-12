"""Smart-blur v1: pattern detection over CAPTURED TEXT (element text and typed
values) at finalize time. Hits flag the step for review in the editor — they do
not blur automatically. Pixel-level OCR detection is a later phase.
"""

import re

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]{2,}")
SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
CARD_CANDIDATE_RE = re.compile(r"\b(?:\d[ -]?){12,19}\b")


def _luhn_valid(digits: str) -> bool:
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def scan_for_sensitive(*texts: str | None) -> list[str]:
    """Returns matched categories, e.g. ["email", "card"]. Order is stable."""
    blob = " ".join(t for t in texts if t)
    if not blob:
        return []
    hits: list[str] = []
    if EMAIL_RE.search(blob):
        hits.append("email")
    if SSN_RE.search(blob):
        hits.append("ssn")
    for candidate in CARD_CANDIDATE_RE.findall(blob):
        if _luhn_valid(re.sub(r"[ -]", "", candidate)):
            hits.append("card")
            break
    return hits
