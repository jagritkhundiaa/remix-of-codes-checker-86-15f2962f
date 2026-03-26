# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 2 — Early Liquidity Detection

import time
from utils.api import api_get
from utils.cache import TTLCache
from config import DEXSCREENER_BASE, LIQUIDITY_MIN

cache = TTLCache(ttl=60)
_previous_pairs = {}

async def detect_new_liquidity(chain="solana"):
    data = await api_get(f"{DEXSCREENER_BASE}/latest/dex/pairs/{chain}")
    if not data or "pairs" not in data:
        return []
    new_tokens = []
    for p in data["pairs"]:
        addr = p.get("pairAddress", "")
        liq = p.get("liquidity", {}).get("usd", 0) or 0
        if liq < LIQUIDITY_MIN:
            continue
        created = p.get("pairCreatedAt")
        if created:
            age_minutes = (time.time() * 1000 - created) / 60000
            if age_minutes > 60:
                continue
        prev = _previous_pairs.get(addr)
        if prev is None:
            _previous_pairs[addr] = {"liquidity": liq, "seen": time.time()}
            new_tokens.append({
                "address": p.get("baseToken", {}).get("address", ""),
                "symbol": p.get("baseToken", {}).get("symbol", ""),
                "name": p.get("baseToken", {}).get("name", ""),
                "chain": chain,
                "pair_address": addr,
                "liquidity": liq,
                "age_minutes": age_minutes if created else None,
                "type": "new_pair",
            })
        elif liq > prev["liquidity"] * 1.5:
            injection = liq - prev["liquidity"]
            _previous_pairs[addr]["liquidity"] = liq
            new_tokens.append({
                "address": p.get("baseToken", {}).get("address", ""),
                "symbol": p.get("baseToken", {}).get("symbol", ""),
                "name": p.get("baseToken", {}).get("name", ""),
                "chain": chain,
                "pair_address": addr,
                "liquidity": liq,
                "injection": injection,
                "type": "liquidity_injection",
            })
        else:
            _previous_pairs[addr]["liquidity"] = liq
    cutoff = time.time() - 7200
    expired = [k for k, v in _previous_pairs.items() if v["seen"] < cutoff]
    for k in expired:
        del _previous_pairs[k]
    return new_tokens
