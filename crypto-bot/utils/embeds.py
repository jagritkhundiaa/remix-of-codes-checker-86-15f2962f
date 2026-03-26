# Crypto Market Intelligence Bot
# Made by TalkNeon

import discord
from config import EMBED_COLOR, THRESHOLDS

FOOTER = "Made by TalkNeon"

def base_embed(title="", description=""):
    em = discord.Embed(title=title, description=description, color=EMBED_COLOR)
    em.set_footer(text=FOOTER)
    return em

def fmt_num(n, decimals=2):
    if n is None:
        return "N/A"
    if abs(n) >= 1_000_000:
        return f"${n/1_000_000:,.{decimals}f}M"
    if abs(n) >= 1_000:
        return f"${n/1_000:,.{decimals}f}K"
    return f"${n:,.{decimals}f}"

def fmt_pct(n):
    if n is None:
        return "N/A"
    sign = "+" if n > 0 else ""
    return f"{sign}{n:.1f}%"

def fmt_price(p):
    if p is None:
        return "N/A"
    if p < 0.0001:
        return f"${p:.8f}"
    if p < 1:
        return f"${p:.6f}"
    return f"${p:,.4f}"

def confidence_label(score):
    if score >= THRESHOLDS["CRITICAL"]:
        return "CRITICAL"
    if score >= THRESHOLDS["HIGH"]:
        return "HIGH"
    if score >= THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    return "LOW"

def bar(value, max_val=100, width=12):
    filled = int((value / max_val) * width) if max_val > 0 else 0
    filled = max(0, min(width, filled))
    return "█" * filled + "░" * (width - filled)

def alert_embed(token_data):
    d = token_data
    level = confidence_label(d.get("confidence", 0))
    em = base_embed(title=f"{d.get('name', '???')} / {d.get('symbol', '???')}")
    lines = []
    lines.append(f"```")
    lines.append(f"Chain       {d.get('chain', 'Unknown'):>16}")
    lines.append(f"Price       {fmt_price(d.get('price')):>16}")
    lines.append(f"Liquidity   {fmt_num(d.get('liquidity')):>16}")
    lines.append(f"Vol 24h     {fmt_num(d.get('volume_24h')):>16}")
    lines.append(f"Vol Change  {fmt_pct(d.get('volume_change')):>16}")
    lines.append(f"Wallets     {str(d.get('wallet_hits', 0)):>16}")
    lines.append(f"Risk        {d.get('risk_label', 'Unknown'):>16}")
    lines.append(f"")
    lines.append(f"Confidence  {bar(d.get('confidence', 0))} {d.get('confidence', 0):.0f}/100")
    lines.append(f"Signal      {level:>16}")
    lines.append(f"```")
    em.description = "\n".join(lines)
    if d.get("address"):
        em.add_field(name="Address", value=f"`{d['address']}`", inline=False)
    return em

def status_embed(stats):
    em = base_embed(title="System Status")
    lines = []
    lines.append("```")
    lines.append(f"Uptime          {stats.get('uptime', 'N/A'):>14}")
    lines.append(f"Tokens Scanned  {stats.get('scanned', 0):>14}")
    lines.append(f"Alerts Sent     {stats.get('alerts', 0):>14}")
    lines.append(f"Tracked Wallets {stats.get('wallets', 0):>14}")
    lines.append(f"Watched Tokens  {stats.get('watched', 0):>14}")
    lines.append(f"Scanner         {'Active' if stats.get('scanner_active') else 'Paused':>14}")
    lines.append("```")
    em.description = "\n".join(lines)
    return em

def balance_embed(address, chain, data):
    em = base_embed(title="Wallet Balance")
    lines = []
    lines.append("```")
    lines.append(f"Address    {address[:8]}...{address[-6:]}")
    lines.append(f"Chain      {chain:>20}")
    lines.append(f"Confirmed  {data.get('confirmed', 'N/A'):>20}")
    lines.append(f"Pending    {data.get('pending', 'N/A'):>20}")
    lines.append(f"Total      {data.get('total', 'N/A'):>20}")
    lines.append("```")
    em.description = "\n".join(lines)
    return em

def scan_embed(results):
    em = base_embed(title="Manual Scan Results")
    if not results:
        em.description = "```\nNo significant signals detected.\n```"
        return em
    lines = ["```"]
    for t in results[:10]:
        name = t.get("symbol", "???")[:8]
        score = t.get("confidence", 0)
        chain = t.get("chain", "?")[:5]
        lines.append(f"{name:<8} {chain:<5} {bar(score, width=10)} {score:.0f}")
    lines.append("```")
    em.description = "\n".join(lines)
    return em

def performance_embed(stats):
    em = base_embed(title="Signal Performance")
    lines = ["```"]
    lines.append(f"Total Alerts      {stats.get('total', 0):>10}")
    lines.append(f"Profitable (5m)   {fmt_pct(stats.get('win_5m')):>10}")
    lines.append(f"Profitable (15m)  {fmt_pct(stats.get('win_15m')):>10}")
    lines.append(f"Profitable (30m)  {fmt_pct(stats.get('win_30m')):>10}")
    lines.append(f"Profitable (60m)  {fmt_pct(stats.get('win_60m')):>10}")
    lines.append(f"Avg Return (15m)  {fmt_pct(stats.get('avg_15m')):>10}")
    lines.append("```")
    em.description = "\n".join(lines)
    return em

def error_embed(message):
    return base_embed(title="Error", description=f"```\n{message}\n```")

def help_embed(prefix):
    em = base_embed(title="Commands")
    lines = ["```"]
    lines.append(f"{prefix}start         System status")
    lines.append(f"{prefix}scan          Manual market scan")
    lines.append(f"{prefix}watch <addr>  Track a token")
    lines.append(f"{prefix}unwatch       Remove tracked token")
    lines.append(f"{prefix}watchlist     Show watched tokens")
    lines.append(f"{prefix}alerts        Toggle auto alerts")
    lines.append(f"{prefix}bal <addr>    Wallet balance lookup")
    lines.append(f"{prefix}addwallet     Track a smart wallet")
    lines.append(f"{prefix}rmwallet      Remove tracked wallet")
    lines.append(f"{prefix}wallets       List tracked wallets")
    lines.append(f"{prefix}perf          Signal performance")
    lines.append(f"{prefix}help          This message")
    lines.append("```")
    em.description = "\n".join(lines)
    return em
