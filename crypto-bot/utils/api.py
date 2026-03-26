# Crypto Market Intelligence Bot
# Made by TalkNeon

import aiohttp
import asyncio
import json

_session = None

async def get_session():
    global _session
    if _session is None or _session.closed:
        timeout = aiohttp.ClientTimeout(total=15)
        _session = aiohttp.ClientSession(timeout=timeout)
    return _session

async def close_session():
    global _session
    if _session and not _session.closed:
        await _session.close()
        _session = None

async def api_get(url, params=None, headers=None, retries=2):
    session = await get_session()
    for attempt in range(retries + 1):
        try:
            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status == 200:
                    return await resp.json()
                if resp.status == 429:
                    wait = min(2 ** attempt * 2, 30)
                    await asyncio.sleep(wait)
                    continue
                return None
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt < retries:
                await asyncio.sleep(1)
            continue
    return None

async def api_post(url, data=None, json_data=None, headers=None, retries=2):
    session = await get_session()
    for attempt in range(retries + 1):
        try:
            async with session.post(url, data=data, json=json_data, headers=headers) as resp:
                if resp.status == 200:
                    return await resp.json()
                if resp.status == 429:
                    await asyncio.sleep(min(2 ** attempt * 2, 30))
                    continue
                return None
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt < retries:
                await asyncio.sleep(1)
            continue
    return None

async def rpc_call(rpc_url, method, params=None):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or [],
    }
    result = await api_post(rpc_url, json_data=payload, headers={"Content-Type": "application/json"})
    if result and "result" in result:
        return result["result"]
    return None
