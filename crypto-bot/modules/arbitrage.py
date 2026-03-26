# Crypto Market Intelligence Bot
# Made by TalkNeon
# Module 7 — Arbitrage Monitor

from modules.discovery import fetch_token_data
from utils.cache import TTLCache

cache = TTLCache(ttl=60)

async def check_arbitrage(token_address, chains=None):
    if chains is None:
        chains = ["solana", "ethereum", "bsc", "base"]
    prices = {}
    for chain in chains:
        data = await fetch_token_data(token_address)
        if data and data.get("price", 0) > 0 and data.get("chain") == chain:
            prices[chain] = {
                "price": data["price"],
                "liquidity": data.get("liquidity", 0),
            }
    if len(prices) < 2:
        return None
    sorted_chains = sorted(prices.items(), key=lambda x: x[1]["price"])
    low_chain, low_data = sorted_chains[0]
    high_chain, high_data = sorted_chains[-1]
    spread_pct = ((high_data["price"] - low_data["price"]) / low_data["price"]) * 100
    min_liq = min(low_data["liquidity"], high_data["liquidity"])
    estimated_fees = 1.5
    net_spread = spread_pct - estimated_fees
    if net_spread < 0.5 or min_liq < 10000:
        return None
    return {
        "buy_chain": low_chain,
        "sell_chain": high_chain,
        "buy_price": low_data["price"],
        "sell_price": high_data["price"],
        "spread_pct": round(spread_pct, 2),
        "net_spread": round(net_spread, 2),
        "min_liquidity": min_liq,
        "viable": net_spread > 1.0 and min_liq > 25000,
    }

async def scan_arbitrage_opportunities(token_addresses, chains=None):
    opportunities = []
    for addr in token_addresses:
        result = await check_arbitrage(addr, chains)
        if result and result["viable"]:
            opportunities.append({"address": addr, **result})
    return sorted(opportunities, key=lambda x: x["net_spread"], reverse=True)
