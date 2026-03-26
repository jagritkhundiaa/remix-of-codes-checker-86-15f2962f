# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 8 — Outcome Tracking

import asyncio
from modules.discovery import fetch_token_data
from utils.db import get_pending_outcomes, log_outcome, get_performance_stats
from config import TRACK_INTERVALS

async def track_outcomes():
    for interval in TRACK_INTERVALS:
        pending = await get_pending_outcomes(interval)
        for alert in pending:
            try:
                current = await fetch_token_data(alert["token_address"])
                if not current or current.get("price", 0) == 0:
                    await log_outcome(alert["id"], interval, None, None)
                    continue
                current_price = current["price"]
                alert_price = alert["price_at_alert"]
                if alert_price and alert_price > 0:
                    change = ((current_price - alert_price) / alert_price) * 100
                else:
                    change = 0
                await log_outcome(alert["id"], interval, current_price, round(change, 2))
            except Exception:
                pass
            await asyncio.sleep(0.5)

async def get_stats():
    return await get_performance_stats()
