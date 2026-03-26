# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 1 — Market Discovery

from utils.api import api_get
from utils.cache import TTLCache
from config import DEXSCREENER_BASE, LIQUIDITY_MIN, VOLUME_MIN

cache = TTLCache(ttl=120)

async def fetch_trending():
    cached = await cache.get("trending")
    if cached:
        return cached
    data = await api_get(f"{DEXSCREENER_BASE}/token-boosts/latest/v1")
    if not data:
        return []
    tokens = []
    for item in data if isinstance(data, list) else []:
        tokens.append({
            "address": item.get("tokenAddress", ""),
            "chain": item.get("chainId", ""),
            "name": item.get("description", ""),
            "symbol": item.get("tokenAddress", "")[:8],
            "url": item.get("url", ""),
        })
    await cache.set("trending", tokens)
    return tokens

async def fetch_new_pairs(chain="solana"):
    key = f"new_pairs_{chain}"
    cached = await cache.get(key)
    if cached:
        return cached
    data = await api_get(f"{DEXSCREENER_BASE}/latest/dex/pairs/{chain}")
    if not data or "pairs" not in data:
        return []
    pairs = []
    for p in data["pairs"]:
        liq = p.get("liquidity", {}).get("usd", 0) or 0
        vol = p.get("volume", {}).get("h24", 0) or 0
        if liq < LIQUIDITY_MIN or vol < VOLUME_MIN:
            continue
        pairs.append(normalize_pair(p))
    await cache.set(key, pairs)
    return pairs

async def search_token(query):
    data = await api_get(f"{DEXSCREENER_BASE}/latest/dex/search", params={"q": query})
    if not data or "pairs" not in data:
        return []
    return [normalize_pair(p) for p in data["pairs"][:10]]

async def fetch_token_data(address):
    data = await api_get(f"{DEXSCREENER_BASE}/latest/dex/tokens/{address}")
    if not data or "pairs" not in data or not data["pairs"]:
        return None
    best = max(data["pairs"], key=lambda p: (p.get("liquidity", {}).get("usd", 0) or 0))
    return normalize_pair(best)

def normalize_pair(p):
    price_change = p.get("priceChange", {})
    volume = p.get("volume", {})
    liquidity = p.get("liquidity", {})
    txns = p.get("txns", {})
    h24_txns = txns.get("h24", {})
    return {
        "address": p.get("baseToken", {}).get("address", ""),
        "name": p.get("baseToken", {}).get("name", ""),
        "symbol": p.get("baseToken", {}).get("symbol", ""),
        "chain": p.get("chainId", ""),
        "pair_address": p.get("pairAddress", ""),
        "dex": p.get("dexId", ""),
        "price": float(p.get("priceUsd", 0) or 0),
        "price_change_5m": price_change.get("m5"),
        "price_change_1h": price_change.get("h1"),
        "price_change_6h": price_change.get("h6"),
        "price_change_24h": price_change.get("h24"),
        "volume_5m": volume.get("m5", 0) or 0,
        "volume_1h": volume.get("h1", 0) or 0,
        "volume_6h": volume.get("h6", 0) or 0,
        "volume_24h": volume.get("h24", 0) or 0,
        "liquidity": liquidity.get("usd", 0) or 0,
        "market_cap": p.get("marketCap") or p.get("fdv") or 0,
        "buys_24h": h24_txns.get("buys", 0) or 0,
        "sells_24h": h24_txns.get("sells", 0) or 0,
        "pair_created": p.get("pairCreatedAt"),
        "url": p.get("url", ""),
    }
