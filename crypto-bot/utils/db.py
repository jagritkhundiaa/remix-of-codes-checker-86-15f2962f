# Crypto Market Intelligence Bot
# Made by TalkNeon

import aiosqlite
import os
import json
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "intel.db")

async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_address TEXT NOT NULL,
                chain TEXT NOT NULL,
                symbol TEXT,
                name TEXT,
                price_at_alert REAL,
                confidence REAL,
                signal_level TEXT,
                scores TEXT,
                created_at REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS outcomes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id INTEGER NOT NULL,
                minutes_after INTEGER NOT NULL,
                price REAL,
                change_pct REAL,
                checked_at REAL NOT NULL,
                FOREIGN KEY (alert_id) REFERENCES alerts(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS tracked_wallets (
                address TEXT PRIMARY KEY,
                label TEXT,
                weight REAL DEFAULT 1.0,
                added_at REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS watched_tokens (
                address TEXT PRIMARY KEY,
                chain TEXT,
                symbol TEXT,
                added_at REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alert_cooldowns (
                token_address TEXT PRIMARY KEY,
                last_alert REAL NOT NULL
            )
        """)
        await db.commit()

async def log_alert(token_data):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO alerts (token_address, chain, symbol, name, price_at_alert, confidence, signal_level, scores, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                token_data.get("address", ""),
                token_data.get("chain", ""),
                token_data.get("symbol", ""),
                token_data.get("name", ""),
                token_data.get("price"),
                token_data.get("confidence", 0),
                token_data.get("signal_level", "LOW"),
                json.dumps(token_data.get("scores", {})),
                time.time(),
            ),
        )
        await db.commit()
        return cursor.lastrowid

async def log_outcome(alert_id, minutes_after, price, change_pct):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO outcomes (alert_id, minutes_after, price, change_pct, checked_at)
               VALUES (?, ?, ?, ?, ?)""",
            (alert_id, minutes_after, price, change_pct, time.time()),
        )
        await db.commit()

async def get_pending_outcomes(interval_minutes):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cutoff = time.time() - (interval_minutes * 60) - 60
        earliest = time.time() - (interval_minutes * 60) - 3600
        rows = await db.execute_fetchall(
            """SELECT a.id, a.token_address, a.chain, a.price_at_alert, a.created_at
               FROM alerts a
               WHERE a.created_at BETWEEN ? AND ?
               AND NOT EXISTS (
                   SELECT 1 FROM outcomes o WHERE o.alert_id = a.id AND o.minutes_after = ?
               )""",
            (earliest, cutoff, interval_minutes),
        )
        return [dict(r) for r in rows]

async def get_performance_stats():
    async with aiosqlite.connect(DB_PATH) as db:
        total = await db.execute_fetchall("SELECT COUNT(*) FROM alerts")
        total = total[0][0] if total else 0
        stats = {"total": total}
        for mins in [5, 15, 30, 60]:
            rows = await db.execute_fetchall(
                "SELECT change_pct FROM outcomes WHERE minutes_after = ?", (mins,)
            )
            if rows:
                changes = [r[0] for r in rows if r[0] is not None]
                if changes:
                    wins = sum(1 for c in changes if c > 0)
                    stats[f"win_{mins}m"] = (wins / len(changes)) * 100
                    stats[f"avg_{mins}m"] = sum(changes) / len(changes)
                else:
                    stats[f"win_{mins}m"] = None
                    stats[f"avg_{mins}m"] = None
            else:
                stats[f"win_{mins}m"] = None
                stats[f"avg_{mins}m"] = None
        return stats

async def add_tracked_wallet(address, label="", weight=1.0):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO tracked_wallets (address, label, weight, added_at) VALUES (?, ?, ?, ?)",
            (address, label, weight, time.time()),
        )
        await db.commit()

async def remove_tracked_wallet(address):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM tracked_wallets WHERE address = ?", (address,))
        await db.commit()

async def get_tracked_wallets():
    async with aiosqlite.connect(DB_PATH) as db:
        rows = await db.execute_fetchall("SELECT address, label, weight FROM tracked_wallets")
        return [{"address": r[0], "label": r[1], "weight": r[2]} for r in rows]

async def add_watched_token(address, chain, symbol=""):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO watched_tokens (address, chain, symbol, added_at) VALUES (?, ?, ?, ?)",
            (address, chain, symbol, time.time()),
        )
        await db.commit()

async def remove_watched_token(address):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM watched_tokens WHERE address = ?", (address,))
        await db.commit()

async def get_watched_tokens():
    async with aiosqlite.connect(DB_PATH) as db:
        rows = await db.execute_fetchall("SELECT address, chain, symbol FROM watched_tokens")
        return [{"address": r[0], "chain": r[1], "symbol": r[2]} for r in rows]

async def check_cooldown(token_address, cooldown_seconds):
    async with aiosqlite.connect(DB_PATH) as db:
        row = await db.execute_fetchall(
            "SELECT last_alert FROM alert_cooldowns WHERE token_address = ?", (token_address,)
        )
        if row and time.time() - row[0][0] < cooldown_seconds:
            return False
        await db.execute(
            "INSERT OR REPLACE INTO alert_cooldowns (token_address, last_alert) VALUES (?, ?)",
            (token_address, time.time()),
        )
        await db.commit()
        return True
