# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 4 — Smart Wallet Tracking

import time
from utils.api import api_get, rpc_call
from utils.db import get_tracked_wallets
from utils.cache import TTLCache
from config import CHAINS

cache = TTLCache(ttl=120)

async def check_wallet_activity(token_address, chain="solana"):
    wallets = await get_tracked_wallets()
    if not wallets:
        return {"hits": 0, "score": 0, "active_wallets": []}
    key = f"wallet_{token_address}"
    cached = await cache.get(key)
    if cached:
        return cached
    active = []
    total_weight = 0
    if chain == "solana":
        for w in wallets:
            holdings = await get_solana_token_accounts(w["address"])
            if any(token_address.lower() in str(h).lower() for h in holdings):
                active.append(w)
                total_weight += w.get("weight", 1.0)
    else:
        pass
    hits = len(active)
    if hits == 0:
        score = 0
    elif hits == 1:
        score = min(30 * total_weight, 60)
    elif hits == 2:
        score = min(50 * total_weight, 80)
    else:
        score = min(70 * total_weight, 100)
    result = {
        "hits": hits,
        "score": score,
        "active_wallets": [w["address"][:8] + "..." for w in active],
        "total_weight": total_weight,
    }
    await cache.set(key, result, ttl=180)
    return result

async def get_solana_token_accounts(wallet_address):
    key = f"sol_tokens_{wallet_address}"
    cached = await cache.get(key)
    if cached:
        return cached
    rpc = CHAINS["solana"]["rpc"]
    result = await rpc_call(rpc, "getTokenAccountsByOwner", [
        wallet_address,
        {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {"encoding": "jsonParsed"},
    ])
    accounts = []
    if result and "value" in result:
        for acc in result["value"]:
            info = acc.get("account", {}).get("data", {}).get("parsed", {}).get("info", {})
            mint = info.get("mint", "")
            amount = info.get("tokenAmount", {}).get("uiAmount", 0) or 0
            if amount > 0:
                accounts.append({"mint": mint, "amount": amount})
    await cache.set(key, accounts, ttl=120)
    return accounts

async def detect_multi_wallet_convergence(token_address, chain="solana"):
    activity = await check_wallet_activity(token_address, chain)
    if activity["hits"] >= 2:
        return {
            "convergence": True,
            "count": activity["hits"],
            "wallets": activity["active_wallets"],
        }
    return {"convergence": False}
