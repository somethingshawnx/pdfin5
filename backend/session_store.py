"""
Anonymous session + credit tracking.

Per the blueprint's pricing model: every visitor gets an anonymous session
(no login required), tracked via a cookie. The first FREE_EDITS exports are
free; after that, exporting requires payment (Phase 5 wires up the actual
payment gateway - for now this layer just tracks usage and blocks/flags
correctly so the business logic is proven out before payments exist).

Sessions are stored in a simple JSON file on disk. This is fine for a
prototype running on one machine; a real deployment would use Redis or a
database instead (see README "Phase 4" notes).
"""

import os
import json
import threading

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)
SESSIONS_FILE = os.path.join(STORAGE_DIR, "sessions.json")

FREE_EDITS = 2
PRICE_PER_EDIT_INR = 5

_lock = threading.Lock()


def _load_all() -> dict:
    if not os.path.exists(SESSIONS_FILE):
        return {}
    try:
        with open(SESSIONS_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {}


def _save_all(sessions: dict):
    with open(SESSIONS_FILE, "w") as f:
        json.dump(sessions, f, indent=2)


def get_session(session_id: str) -> dict:
    """Return this session's usage record, creating it if it doesn't exist yet."""
    with _lock:
        sessions = _load_all()
        if session_id not in sessions:
            sessions[session_id] = {"edits_used": 0}
            _save_all(sessions)
        record = sessions[session_id]

    edits_used = record["edits_used"]
    free_remaining = max(0, FREE_EDITS - edits_used)
    return {
        "session_id": session_id,
        "edits_used": edits_used,
        "free_edits": FREE_EDITS,
        "free_edits_remaining": free_remaining,
        "requires_payment": free_remaining == 0,
        "price_per_edit_inr": PRICE_PER_EDIT_INR,
    }


def can_export(session_id: str) -> bool:
    status = get_session(session_id)
    return status["free_edits_remaining"] > 0


def record_edit_used(session_id: str) -> dict:
    """Call this after a successful export to consume one credit."""
    with _lock:
        sessions = _load_all()
        if session_id not in sessions:
            sessions[session_id] = {"edits_used": 0}
        sessions[session_id]["edits_used"] += 1
        _save_all(sessions)
    return get_session(session_id)