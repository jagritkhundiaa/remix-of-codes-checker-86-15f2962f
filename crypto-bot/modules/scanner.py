# Crypto Market Intelligence Bot
# Made by TalkNeon
# Scanner — Background worker that ties all modules together

import asyncio
import time
from modules.discovery import fetch_trending, fetch_new_pairs
from modules.liquidity import detect_new_liquidity
from modules.signal_engine import compute_signal
from modules.entry_timing import evaluate_timing
from modules.alerts import process_alert
from modules.tracker import track_outcomes
from config import CHAINS, SCAN_INTERVAL, THRESHOLDS

class Scanner:
    def __init__(self):
        self.active = False
        self.scanned = 0
        self.alerts_sent = 0
        self.start_time = None
        self._task = None

    def start(self, loop=None):
        if self.active:
            return
        self.active = True
        self.start_time = time.time()
        self._task = asyncio.ensure_future(self._run_loop())

    def stop(self):
        self.active = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _run_loop(self):
        while self.active:
            try:
                await self._scan_cycle()
            except Exception as e:
                print(f"[Scanner] Cycle error: {e}")
            try:
                await track_outcomes()
            except Exception as e:
                print(f"[Scanner] Outcome tracking error: {e}")
            await asyncio.sleep(SCAN_INTERVAL)

    async def _scan_cycle(self):
        candidates = {}
        trending = await fetch_trending()
        for t in trending:
            addr = t.get("address", "")
            if addr:
                candidates[addr] = t
        for chain in CHAINS:
            pairs = await fetch_new_pairs(chain)
            for p in pairs:
                addr = p.get("address", "")
                if addr and addr not in candidates:
                    candidates[addr] = p
            new_liq = await detect_new_liquidity(chain)
            for nl in new_liq:
                addr = nl.get("address", "")
                if addr and addr not in candidates:
                    candidates[addr] = nl
            await asyncio.sleep(1)
        for addr, token in candidates.items():
            try:
                if not token.get("price"):
                    from modules.discovery import fetch_token_data
                    full = await fetch_token_data(addr)
                    if full:
                        token = full
                    else:
                        continue
                scored = await compute_signal(token)
                self.scanned += 1
                if scored.get("confidence", 0) >= THRESHOLDS["MEDIUM"]:
                    timing = evaluate_timing(scored)
                    if timing["favorable"] or scored["confidence"] >= THRESHOLDS["HIGH"]:
                        scored["timing"] = timing
                        alert_id = await process_alert(scored)
                        if alert_id:
                            self.alerts_sent += 1
            except Exception as e:
                print(f"[Scanner] Token {addr[:12]}... error: {e}")
            await asyncio.sleep(0.3)

    async def manual_scan(self):
        results = []
        trending = await fetch_trending()
        for chain in CHAINS:
            pairs = await fetch_new_pairs(chain)
            trending.extend(pairs)
        seen = set()
        for t in trending[:30]:
            addr = t.get("address", "")
            if not addr or addr in seen:
                continue
            seen.add(addr)
            try:
                if not t.get("price"):
                    from modules.discovery import fetch_token_data
                    full = await fetch_token_data(addr)
                    if full:
                        t = full
                    else:
                        continue
                scored = await compute_signal(t)
                timing = evaluate_timing(scored)
                scored["timing"] = timing
                results.append(scored)
            except Exception:
                pass
            await asyncio.sleep(0.3)
        results.sort(key=lambda x: x.get("confidence", 0), reverse=True)
        return results[:15]

    def get_uptime(self):
        if not self.start_time:
            return "N/A"
        elapsed = int(time.time() - self.start_time)
        hours, remainder = divmod(elapsed, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours > 0:
            return f"{hours}h {minutes}m"
        return f"{minutes}m {seconds}s"
