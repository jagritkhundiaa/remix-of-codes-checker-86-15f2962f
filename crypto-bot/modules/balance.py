# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 10 — Wallet Balance Tool

import re
from utils.api import api_get, rpc_call
from config import CHAINS

def detect_chain(address):
    if re.match(r'^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$', address):
        return "btc"
    if re.match(r'^bc1[a-zA-HJ-NP-Z0-9]{25,89}$', address):
        return "btc"
    if re.match(r'^0x[a-fA-F0-9]{40}$', address):
        return "eth"
    if re.match(r'^[1-9A-HJ-NP-Za-km-z]{32,44}$', address):
        return "solana"
    return None

async def get_balance(address):
    chain = detect_chain(address)
    if not chain:
        return None, "Could not detect chain for this address."
    if chain == "solana":
        return await get_solana_balance(address), chain
    elif chain == "eth":
        return await get_eth_balance(address), chain
    elif chain == "btc":
        return await get_btc_balance(address), chain
    return None, chain

async def get_solana_balance(address):
    rpc = CHAINS["solana"]["rpc"]
    result = await rpc_call(rpc, "getBalance", [address])
    if result is None:
        return {"confirmed": "Error", "pending": "N/A", "total": "Error"}
    lamports = result.get("value", 0) if isinstance(result, dict) else result
    sol = lamports / 1_000_000_000
    return {
        "confirmed": f"{sol:.6f} SOL",
        "pending": "N/A",
        "total": f"{sol:.6f} SOL",
    }

async def get_eth_balance(address):
    rpc = CHAINS["ethereum"]["rpc"]
    result = await rpc_call(rpc, "eth_getBalance", [address, "latest"])
    if result is None:
        return {"confirmed": "Error", "pending": "N/A", "total": "Error"}
    wei = int(result, 16) if isinstance(result, str) else result
    eth = wei / 1_000_000_000_000_000_000
    return {
        "confirmed": f"{eth:.6f} ETH",
        "pending": "N/A",
        "total": f"{eth:.6f} ETH",
    }

async def get_btc_balance(address):
    data = await api_get(f"https://blockchain.info/rawaddr/{address}?limit=0")
    if not data:
        data = await api_get(f"https://blockstream.info/api/address/{address}")
        if not data:
            return {"confirmed": "Error", "pending": "N/A", "total": "Error"}
        funded = data.get("chain_stats", {}).get("funded_txo_sum", 0)
        spent = data.get("chain_stats", {}).get("spent_txo_sum", 0)
        confirmed = (funded - spent) / 100_000_000
        m_funded = data.get("mempool_stats", {}).get("funded_txo_sum", 0)
        m_spent = data.get("mempool_stats", {}).get("spent_txo_sum", 0)
        pending = (m_funded - m_spent) / 100_000_000
        return {
            "confirmed": f"{confirmed:.8f} BTC",
            "pending": f"{pending:.8f} BTC",
            "total": f"{confirmed + pending:.8f} BTC",
        }
    confirmed = data.get("final_balance", 0) / 100_000_000
    return {
        "confirmed": f"{confirmed:.8f} BTC",
        "pending": "N/A",
        "total": f"{confirmed:.8f} BTC",
    }
