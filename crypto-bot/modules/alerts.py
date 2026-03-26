# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 9 — Alert System

import asyncio
from utils.db import check_cooldown, log_alert
from utils.embeds import alert_embed, confidence_label
from config import ALERT_COOLDOWN, THRESHOLDS

_alert_queue = asyncio.Queue()
_alert_channel = None

def set_alert_channel(channel):
    global _alert_channel
    _alert_channel = channel

async def should_alert(token_data):
    confidence = token_data.get("confidence", 0)
    if confidence < THRESHOLDS["MEDIUM"]:
        return False
    address = token_data.get("address", "")
    if not address:
        return False
    can_alert = await check_cooldown(address, ALERT_COOLDOWN)
    return can_alert

async def process_alert(token_data):
    if not await should_alert(token_data):
        return None
    alert_id = await log_alert(token_data)
    token_data["alert_id"] = alert_id
    await _alert_queue.put(token_data)
    return alert_id

async def alert_worker():
    while True:
        try:
            token_data = await asyncio.wait_for(_alert_queue.get(), timeout=5)
        except asyncio.TimeoutError:
            continue
        if _alert_channel is None:
            continue
        try:
            embed = alert_embed(token_data)
            await _alert_channel.send(embed=embed)
        except Exception as e:
            print(f"[Alert] Send failed: {e}")
        await asyncio.sleep(1)
