# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 6 — Entry Timing

def evaluate_timing(token):
    pc_5m = token.get("price_change_5m") or 0
    pc_1h = token.get("price_change_1h") or 0
    pc_6h = token.get("price_change_6h") or 0
    pc_24h = token.get("price_change_24h") or 0
    buys = token.get("buys_24h", 0)
    sells = token.get("sells_24h", 0)
    vol_5m = token.get("volume_5m", 0)
    vol_1h = token.get("volume_1h", 0)
    stage = classify_stage(pc_5m, pc_1h, pc_6h, pc_24h)
    imbalance = compute_imbalance(buys, sells)
    vol_accel = compute_acceleration(vol_5m, vol_1h)
    timing_score = 50
    if stage == "early":
        timing_score += 25
    elif stage == "mid":
        timing_score += 10
    elif stage == "late":
        timing_score -= 15
    elif stage == "exhaustion":
        timing_score -= 30
    if imbalance > 0.3:
        timing_score += 15
    elif imbalance < -0.3:
        timing_score -= 15
    if vol_accel > 2:
        timing_score += 10
    return {
        "score": max(0, min(100, timing_score)),
        "stage": stage,
        "imbalance": round(imbalance, 2),
        "acceleration": round(vol_accel, 2),
        "favorable": timing_score >= 55,
    }

def classify_stage(pc_5m, pc_1h, pc_6h, pc_24h):
    if pc_1h > 5 and pc_6h < 20 and pc_24h < 50:
        return "early"
    if pc_1h > 10 and pc_6h > 20 and pc_24h < 100:
        return "mid"
    if pc_1h > 20 and pc_6h > 50:
        return "late"
    if pc_1h < 0 and pc_6h > 30:
        return "exhaustion"
    if pc_5m > 3 and pc_1h < 10:
        return "early"
    return "neutral"

def compute_imbalance(buys, sells):
    total = buys + sells
    if total == 0:
        return 0
    return (buys - sells) / total

def compute_acceleration(vol_5m, vol_1h):
    if vol_1h == 0:
        return 0
    expected_5m = vol_1h / 12
    if expected_5m == 0:
        return 0
    return vol_5m / expected_5m
