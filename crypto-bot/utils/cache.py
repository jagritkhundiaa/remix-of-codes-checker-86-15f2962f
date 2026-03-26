# Crypto Market Intelligence Bot
# Made by TalkNeon

import time
import asyncio

class TTLCache:
    def __init__(self, ttl=300):
        self.ttl = ttl
        self.store = {}
        self.lock = asyncio.Lock()

    async def get(self, key):
        async with self.lock:
            entry = self.store.get(key)
            if not entry:
                return None
            if time.time() > entry["expires"]:
                del self.store[key]
                return None
            return entry["value"]

    async def set(self, key, value, ttl=None):
        async with self.lock:
            self.store[key] = {
                "value": value,
                "expires": time.time() + (ttl or self.ttl),
            }

    async def has(self, key):
        return await self.get(key) is not None

    async def delete(self, key):
        async with self.lock:
            self.store.pop(key, None)

    async def clear(self):
        async with self.lock:
            self.store.clear()

    async def cleanup(self):
        async with self.lock:
            now = time.time()
            expired = [k for k, v in self.store.items() if now > v["expires"]]
            for k in expired:
                del self.store[k]
