# Crypto Market Intelligence Bot
# Made by TalkNeon

import discord
from discord.ext import commands
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import BOT_TOKEN, PREFIX, OWNER_ID, ALERT_CHANNEL_ID
from utils.db import (
    init_db, add_tracked_wallet, remove_tracked_wallet, get_tracked_wallets,
    add_watched_token, remove_watched_token, get_watched_tokens,
)
from utils.embeds import (
    base_embed, alert_embed, status_embed, balance_embed, scan_embed,
    performance_embed, error_embed, help_embed, FOOTER,
)
from utils.api import close_session
from modules.scanner import Scanner
from modules.discovery import fetch_token_data, search_token
from modules.signal_engine import compute_signal
from modules.entry_timing import evaluate_timing
from modules.balance import get_balance, detect_chain
from modules.alerts import set_alert_channel, alert_worker
from modules.tracker import get_stats

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=PREFIX, intents=intents, help_command=None)
scanner = Scanner()
alerts_enabled = True


@bot.event
async def on_ready():
    await init_db()
    print(f"[Bot] Logged in as {bot.user}")
    print(f"[Bot] Servers: {len(bot.guilds)}")
    if ALERT_CHANNEL_ID:
        ch = bot.get_channel(int(ALERT_CHANNEL_ID))
        if ch:
            set_alert_channel(ch)
            print(f"[Bot] Alert channel: #{ch.name}")
    asyncio.ensure_future(alert_worker())
    scanner.start()
    print("[Bot] Scanner started")
    await bot.change_presence(
        activity=discord.Activity(type=discord.ActivityType.watching, name="markets")
    )


@bot.event
async def on_message(message):
    if message.author.bot:
        return
    await bot.process_commands(message)


# ── .start ────────────────────────────────────────────────
@bot.command(name="start")
async def cmd_start(ctx):
    wallets = await get_tracked_wallets()
    watched = await get_watched_tokens()
    stats = {
        "uptime": scanner.get_uptime(),
        "scanned": scanner.scanned,
        "alerts": scanner.alerts_sent,
        "wallets": len(wallets),
        "watched": len(watched),
        "scanner_active": scanner.active,
    }
    await ctx.send(embed=status_embed(stats))


# ── .scan ─────────────────────────────────────────────────
@bot.command(name="scan")
async def cmd_scan(ctx):
    msg = await ctx.send(embed=base_embed(description="```\nScanning markets...\n```"))
    try:
        results = await scanner.manual_scan()
        await msg.edit(embed=scan_embed(results))
    except Exception as e:
        await msg.edit(embed=error_embed(str(e)[:200]))


# ── .watch ────────────────────────────────────────────────
@bot.command(name="watch")
async def cmd_watch(ctx, address: str = None):
    if not address:
        await ctx.send(embed=error_embed("Usage: .watch <token_address>"))
        return
    data = await fetch_token_data(address)
    if not data:
        await ctx.send(embed=error_embed("Token not found on Dexscreener."))
        return
    await add_watched_token(address, data.get("chain", ""), data.get("symbol", ""))
    em = base_embed(description=f"```\nNow watching: {data.get('symbol', address[:12])}\nChain: {data.get('chain', 'Unknown')}\n```")
    await ctx.send(embed=em)


# ── .unwatch ──────────────────────────────────────────────
@bot.command(name="unwatch")
async def cmd_unwatch(ctx, address: str = None):
    if not address:
        await ctx.send(embed=error_embed("Usage: .unwatch <token_address>"))
        return
    await remove_watched_token(address)
    await ctx.send(embed=base_embed(description="```\nToken removed from watchlist.\n```"))


# ── .watchlist ────────────────────────────────────────────
@bot.command(name="watchlist")
async def cmd_watchlist(ctx):
    tokens = await get_watched_tokens()
    if not tokens:
        await ctx.send(embed=base_embed(description="```\nNo tokens being watched.\n```"))
        return
    lines = ["```"]
    for t in tokens:
        lines.append(f"{t['symbol'] or t['address'][:12]:<12} {t['chain']:<8} {t['address'][:16]}...")
    lines.append("```")
    await ctx.send(embed=base_embed(title="Watchlist", description="\n".join(lines)))


# ── .alerts ───────────────────────────────────────────────
@bot.command(name="alerts")
async def cmd_alerts(ctx):
    global alerts_enabled
    alerts_enabled = not alerts_enabled
    state = "enabled" if alerts_enabled else "disabled"
    await ctx.send(embed=base_embed(description=f"```\nAlerts {state}.\n```"))


# ── .bal ──────────────────────────────────────────────────
@bot.command(name="bal")
async def cmd_balance(ctx, address: str = None):
    if not address:
        await ctx.send(embed=error_embed("Usage: .bal <wallet_address>"))
        return
    msg = await ctx.send(embed=base_embed(description="```\nFetching balance...\n```"))
    result, chain = await get_balance(address)
    if result is None:
        await msg.edit(embed=error_embed(chain))
        return
    await msg.edit(embed=balance_embed(address, chain, result))


# ── .addwallet ────────────────────────────────────────────
@bot.command(name="addwallet")
async def cmd_addwallet(ctx, address: str = None, label: str = "", weight: float = 1.0):
    if not address:
        await ctx.send(embed=error_embed("Usage: .addwallet <address> [label] [weight]"))
        return
    await add_tracked_wallet(address, label, weight)
    await ctx.send(embed=base_embed(
        description=f"```\nWallet tracked: {address[:12]}...\nLabel: {label or 'None'}\nWeight: {weight}\n```"
    ))


# ── .rmwallet ─────────────────────────────────────────────
@bot.command(name="rmwallet")
async def cmd_rmwallet(ctx, address: str = None):
    if not address:
        await ctx.send(embed=error_embed("Usage: .rmwallet <address>"))
        return
    await remove_tracked_wallet(address)
    await ctx.send(embed=base_embed(description="```\nWallet removed.\n```"))


# ── .wallets ──────────────────────────────────────────────
@bot.command(name="wallets")
async def cmd_wallets(ctx):
    wallets = await get_tracked_wallets()
    if not wallets:
        await ctx.send(embed=base_embed(description="```\nNo wallets being tracked.\n```"))
        return
    lines = ["```"]
    for w in wallets:
        label = w["label"] or "—"
        lines.append(f"{w['address'][:12]}...  {label:<10} w={w['weight']}")
    lines.append("```")
    await ctx.send(embed=base_embed(title="Tracked Wallets", description="\n".join(lines)))


# ── .perf ─────────────────────────────────────────────────
@bot.command(name="perf")
async def cmd_perf(ctx):
    stats = await get_stats()
    await ctx.send(embed=performance_embed(stats))


# ── .lookup ───────────────────────────────────────────────
@bot.command(name="lookup")
async def cmd_lookup(ctx, query: str = None):
    if not query:
        await ctx.send(embed=error_embed("Usage: .lookup <token_name_or_address>"))
        return
    msg = await ctx.send(embed=base_embed(description="```\nSearching...\n```"))
    data = await fetch_token_data(query)
    if not data:
        results = await search_token(query)
        if results:
            data = results[0]
    if not data:
        await msg.edit(embed=error_embed("Token not found."))
        return
    scored = await compute_signal(data)
    timing = evaluate_timing(scored)
    scored["timing"] = timing
    await msg.edit(embed=alert_embed(scored))


# ── .help ─────────────────────────────────────────────────
@bot.command(name="help")
async def cmd_help(ctx):
    await ctx.send(embed=help_embed(PREFIX))


# ── Shutdown ──────────────────────────────────────────────
@bot.event
async def on_close():
    scanner.stop()
    await close_session()


if __name__ == "__main__":
    if BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        print("[Error] Set your BOT_TOKEN in config.py")
        sys.exit(1)
    bot.run(BOT_TOKEN)
