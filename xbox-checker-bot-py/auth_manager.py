# ============================================================
#  Authorization & Admin Manager
#  - Owner can .auth <@user|id> <duration>
#  - Owner can .makeadmin <@user|id> to grant admin role
#  - Admins can also .auth users
#  - Tracks expiration, persists to JSON
# ============================================================

import json
import os
import re
import time

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
AUTH_FILE = os.path.join(DATA_DIR, "authorized.json")
ADMIN_FILE = os.path.join(DATA_DIR, "admins.json")


def _ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _load(path):
    _ensure_dir()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _save(path, data):
    _ensure_dir()
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ── Duration parsing ──

DURATION_PATTERN = re.compile(
    r"^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|week|mo|month)s?$", re.IGNORECASE
)

MULTIPLIERS = {
    "s": 1, "sec": 1,
    "m": 60, "min": 60,
    "h": 3600, "hr": 3600, "hour": 3600,
    "d": 86400, "day": 86400,
    "w": 604800, "week": 604800,
    "mo": 2592000, "month": 2592000,
}


def parse_duration(text):
    """Return seconds (int) or float('inf') for permanent. None if invalid."""
    if not text:
        return None
    t = text.strip().lower()
    if t in ("forever", "perm", "permanent"):
        return float("inf")
    m = DURATION_PATTERN.match(t)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower()
    mult = MULTIPLIERS.get(unit)
    return n * mult if mult else None


def format_duration(seconds):
    if seconds == float("inf"):
        return "Permanent"
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m"
    if seconds < 86400:
        return f"{int(seconds // 3600)}h"
    return f"{int(seconds // 86400)}d"


def format_expiry(expires_at):
    if expires_at == float("inf") or expires_at == "Infinity":
        return "Never"
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(expires_at))


# ── Auth Manager ──

class AuthManager:
    def __init__(self):
        self.data = _load(AUTH_FILE)
        self.admins = _load(ADMIN_FILE)  # { userId: { addedBy, addedAt } }

    # ── Authorization ──

    def authorize(self, user_id, duration_secs, authorized_by):
        expires_at = "Infinity" if duration_secs == float("inf") else time.time() + duration_secs
        self.data[str(user_id)] = {
            "expires_at": expires_at,
            "authorized_by": str(authorized_by),
            "authorized_at": time.time(),
        }
        _save(AUTH_FILE, self.data)

    def deauthorize(self, user_id):
        uid = str(user_id)
        if uid in self.data:
            del self.data[uid]
            _save(AUTH_FILE, self.data)
            return True
        return False

    def is_authorized(self, user_id):
        entry = self.data.get(str(user_id))
        if not entry:
            return False
        exp = entry.get("expires_at")
        if exp == "Infinity":
            return True
        if time.time() < exp:
            return True
        # Expired — clean up
        del self.data[str(user_id)]
        _save(AUTH_FILE, self.data)
        return False

    def get_entry(self, user_id):
        return self.data.get(str(user_id))

    def get_all_authorized(self):
        now = time.time()
        active = []
        for uid, entry in list(self.data.items()):
            exp = entry.get("expires_at")
            if exp == "Infinity" or now < exp:
                active.append({"user_id": uid, **entry})
        return active

    # ── Admin role ──

    def make_admin(self, user_id, added_by):
        uid = str(user_id)
        self.admins[uid] = {"added_by": str(added_by), "added_at": time.time()}
        _save(ADMIN_FILE, self.admins)

    def remove_admin(self, user_id):
        uid = str(user_id)
        if uid in self.admins:
            del self.admins[uid]
            _save(ADMIN_FILE, self.admins)
            return True
        return False

    def is_admin(self, user_id):
        return str(user_id) in self.admins

    def get_all_admins(self):
        return list(self.admins.keys())
