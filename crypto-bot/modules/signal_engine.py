# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 5 — Signal Engine

from config import WEIGHTS, THRESHOLDS
from modules.risk import check_risk
from modules.wallets import check_wallet_activity

def momentum_score(token):
    score = 50
    pc_5m = token.get("price_change_5m") or 0
    pc_1h = token.get("price_change_1h") or 0
    pc_6h = token.get("price_change_6h") or 0
    if pc_5m > 5:
        score += min(pc_5m * 2, 25)
    elif pc_5m < -5:
        score -= min(abs(pc_5m) * 1.5, 20)
    if pc_1h > 10:
        score += min(pc_1h, 20)
    elif pc_1h < -10:
        score -= min(abs(pc_1h) * 0.8, 15)
    if pc_6h > 0 and pc_1h > 0 and pc_5m > 0:
        score += 10
    return max(0, min(100, score))

def volume_score(token):
    vol_5m = token.get("volume_5m", 0)
    vol_1h = token.get("volume_1h", 0)
    vol_24h = token.get("volume_24h", 0)
    liq = token.get("liquidity", 1)
    score = 30
    if vol_1h > 0 and vol_24h > 0:
        hourly_avg = vol_24h / 24
        if vol_1h > hourly_avg * 3:
            score += 30
        elif vol_1h > hourly_avg * 1.5:
            score += 15
    vol_liq_ratio = vol_24h / max(liq, 1)
    if vol_liq_ratio > 5:
        score += 20
    elif vol_liq_ratio > 2:
        score += 10
    if vol_5m > 0 and vol_1h > 0:
        concentration = vol_5m / (vol_1h / 12)
        if concentration > 3:
            score -= 10
    return max(0, min(100, score))

def liquidity_score(token):
    liq = token.get("liquidity", 0)
    if liq < 5000:
        return 10
    if liq < 20000:
        return 30
    if liq < 50000:
        return 50
    if liq < 200000:
        return 70
    if liq < 1000000:
        return 85
    return 95

async def compute_signal(token):
    m_score = momentum_score(token)
    v_score = volume_score(token)
    l_score = liquidity_score(token)
    risk_data = await check_risk(token.get("address", ""), token.get("chain", "solana"))
    r_score = risk_data.get("score", 50)
    wallet_data = await check_wallet_activity(token.get("address", ""), token.get("chain", "solana"))
    w_score = wallet_data.get("score", 0)
    confidence = (
        m_score * WEIGHTS["momentum"]
        + v_score * WEIGHTS["volume"]
        + l_score * WEIGHTS["liquidity"]
        + w_score * WEIGHTS["wallet"]
        + r_score * WEIGHTS["risk"]
    )
    if not risk_data.get("safe", True):
        confidence *= 0.3
    if confidence >= THRESHOLDS["CRITICAL"]:
        level = "CRITICAL"
    elif confidence >= THRESHOLDS["HIGH"]:
        level = "HIGH"
    elif confidence >= THRESHOLDS["MEDIUM"]:
        level = "MEDIUM"
    else:
        level = "LOW"
    token["confidence"] = round(confidence, 1)
    token["signal_level"] = level
    token["risk_label"] = risk_data.get("label", "Unknown")
    token["wallet_hits"] = wallet_data.get("hits", 0)
    token["scores"] = {
        "momentum": round(m_score, 1),
        "volume": round(v_score, 1),
        "liquidity": round(l_score, 1),
        "wallet": round(w_score, 1),
        "risk": round(r_score, 1),
    }
    return token
