"""
WLID Storage — persistent WLID tokens set via .wlidset
"""
import json
import os

WLID_FILE = os.path.join(os.path.dirname(__file__), "data", "wlids.json")


def _ensure_dir():
    d = os.path.dirname(WLID_FILE)
    os.makedirs(d, exist_ok=True)


def load_wlids():
    _ensure_dir()
    if not os.path.exists(WLID_FILE):
        return []
    try:
        with open(WLID_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return []


def save_wlids(wlids):
    _ensure_dir()
    with open(WLID_FILE, "w") as f:
        json.dump(wlids, f, indent=2)


def set_wlids(wlids):
    save_wlids(wlids)


def get_wlids():
    return load_wlids()


def get_wlid_count():
    return len(load_wlids())
