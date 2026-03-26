# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 3 — Risk Filtering

from utils.api import api_get
from utils.cache import TTLCache
from config import RUGCHECK_BASE

cache = TTLCache(ttl=300)

async def check_risk(token_address, chain="solana"):
    if chain != "solana":
        return {"safe": True, "score": 80, "risks": [], "label": "Unverified"}
    key = f"risk_{token_address}"
    cached = await cache.get(key)
    if cached:
        return cached
    data = await api_get(f"{RUGCHECK_BASE}/tokens/{token_address}/report/summary")
    if not data:
        result = {"safe": True, "score": 50, "risks": [], "label": "Unknown"}
        await cache.set(key, result)
        return result
    risks = data.get("risks", [])
    risk_names = [r.get("name", "") for r in risks]
    score_val = data.get("score", 0)
    critical_flags = [
        "Freeze Authority still enabled",
        "Mint Authority still enabled",
        "Single holder owns >90%",
        "Low Liquidity",
    ]
    has_critical = any(flag in risk_names for flag in critical_flags)
    if has_critical or score_val > 5000:
        label = "Dangerous"
        safe = False
        risk_score = 10
    elif score_val > 2000:
        label = "Risky"
        safe = False
        risk_score = 30
    elif score_val > 500:
        label = "Caution"
        safe = True
        risk_score = 55
    elif score_val > 100:
        label = "Moderate"
        safe = True
        risk_score = 75
    else:
        label = "Good"
        safe = True
        risk_score = 95
    result = {
        "safe": safe,
        "score": risk_score,
        "risks": risk_names[:5],
        "label": label,
        "raw_score": score_val,
    }
    await cache.set(key, result)
    return result
