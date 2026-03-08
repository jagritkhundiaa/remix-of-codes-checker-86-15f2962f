import discord
from discord.ext import commands
from discord import app_commands
import asyncio
import io
import time
import threading
import re

import config
from checker import check_accounts
from gen_manager import GenManager
from hotmail_checker import check_hotmail_accounts
from wlid_store import set_wlids, get_wlids, get_wlid_count
from ms_claimer import claim_wlids
from ms_code_checker import check_codes
from ms_puller import pull_codes, pull_links
from ms_inbox import check_inbox_accounts, get_service_count

intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix=config.PREFIX, intents=intents, help_command=None)
gen = GenManager()
active_stops = {}

MAX_COMBO_LINES = 4000

def e(color=None):
    em = discord.Embed(color=color or config.EMBED_COLOR, timestamp=discord.utils.utcnow())
    em.set_footer(text=config.FOOTER)
    return em

def bar(cur, tot, w=20):
    pct = cur / tot if tot > 0 else 0
    f = round(pct * w)
    return "\u2588" * f + "\u2591" * (w - f) + f" {cur}/{tot}"

def txt_file(lines, name):
    buf = io.BytesIO("\n".join(lines).encode("utf-8"))
    return discord.File(buf, filename=name)

def is_owner(uid):
    return str(uid) == config.OWNER_ID

def parse_uid(s):
    if not s:
        return None
    s = s.strip()
    if s.startswith("<@") and s.endswith(">"):
        return s.replace("<@", "").replace("!", "").replace(">", "")
    if s.isdigit() and len(s) >= 17:
        return s
    return None

def extract_combos(raw):
    """Extract email:pass combos, cleaning dirty input."""
    lines = raw.replace(",", "\n").splitlines()
    combos = []
    dirty = False
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if "|" in line:
            dirty = True
            parts = line.split("|")[0].strip()
            if ":" in parts:
                combos.append(parts)
        elif line.count(":") > 1:
            dirty = True
            parts = line.split(":")
            combos.append(f"{parts[0]}:{parts[1]}")
        elif ":" in line:
            combos.append(line)
    return combos, dirty

async def fetch_lines(att):
    try:
        data = await att.read()
        return [l.strip() for l in data.decode("utf-8", errors="ignore").splitlines() if l.strip()]
    except Exception:
        return []

# ── Shared logic ──

async def do_xbox_check(ctx_or_inter, accounts, threads, is_slash=False):
    """Shared Xbox check logic for both prefix and slash commands."""
    accounts = list(set(accounts))

    async def send(embed=None, files=None, **kw):
        if is_slash:
            if files:
                return await ctx_or_inter.followup.send(embed=embed, files=files, **kw)
            return await ctx_or_inter.followup.send(embed=embed, **kw)
        if files:
            return await ctx_or_inter.send(embed=embed, files=files, **kw)
        return await ctx_or_inter.send(embed=embed, **kw)

    if not accounts:
        return await send(embed=e().add_field(name="", value="No valid email:pass combos provided."))
    if len(accounts) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many accounts. Max {MAX_COMBO_LINES} lines."))

    tc = min(max(threads or config.MAX_THREADS, 1), 50)
    total_accounts = len(accounts)
    msg = await send(embed=e().add_field(name="", value=(
        f"Starting check on {total_accounts} accounts ({tc} threads)...\n"
        "Warm-up can take up to 30s before first completed result.\n\n"
        f"`{bar(0, total_accounts)}`"
    )))

    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    user = ctx_or_inter.user if is_slash else ctx_or_inter.author
    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]

    def on_progress(done, total):
        now = time.time()
        if now - last_edit[0] < 2:
            return
        last_edit[0] = now
        sec = now - t0
        cpm = round(done / (sec / 60)) if sec > 0 else 0
        em = e()
        em.description = f"Checking...\n\n`{bar(done, total)}`\n\nCPM: {cpm} | {sec:.1f}s"
        try:
            asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)
        except Exception:
            pass

    results = await bot.loop.run_in_executor(
        None, lambda: check_accounts(accounts, tc, on_progress, stop)
    )

    active_stops.pop(str(user.id), None)

    s = {"checked": len(results), "hits": 0, "free": 0, "locked": 0, "fails": 0}
    hit_l, free_l, lock_l = [], [], []

    for r in results:
        if r["status"] == "hit":
            s["hits"] += 1
            caps = " | ".join(f"{k}: {v}" for k, v in r.get("captures", {}).items())
            hit_l.append(f"{r['user']}:{r['password']} | {caps}")
        elif r["status"] == "free":
            s["free"] += 1
            caps = " | ".join(f"{k}: {v}" for k, v in r.get("captures", {}).items())
            free_l.append(f"{r['user']}:{r['password']} | {caps}")
        elif r["status"] == "locked":
            s["locked"] += 1
            lock_l.append(f"{r['user']}:{r['password']} -> {r.get('detail', '')}")
        else:
            s["fails"] += 1

    sec = time.time() - t0
    s["cpm"] = round(s["checked"] / (sec / 60)) if sec > 0 else 0

    re_em = e()
    re_em.title = "Check Results"
    for k, v in s.items():
        re_em.add_field(name=k.capitalize(), value=f"`{v}`", inline=True)

    files = []
    if hit_l: files.append(txt_file(hit_l, "Hits.txt"))
    if free_l: files.append(txt_file(free_l, "Free.txt"))
    if lock_l: files.append(txt_file(lock_l, "Locked.txt"))

    try:
        dm = await user.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value="Done. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)


async def do_gen(ctx_or_inter, cat, is_slash=False):
    """Shared gen logic."""
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author
    uid = str(user.id)

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        else:
            return await ctx_or_inter.send(**kw)

    if not cat:
        cats = gen.get_categories()
        if not cats:
            return await send(embed=e().add_field(name="", value="No categories available."))
        st = gen.all_stock_counts()
        lines = "\n".join(f"`{c}` — {st[c]} in stock" for c in cats)
        return await send(embed=e().add_field(name="Categories", value=lines + f"\n\nUsage: `/gen <category>` or `{config.PREFIX}gen <category>`"))

    res = gen.generate(uid, cat.lower())

    if res.get("error") == "not_found":
        return await send(embed=e().add_field(name="", value=f"Category `{cat}` not found."))
    if res.get("error") == "limit":
        s = gen.stats(uid)
        return await send(embed=e().add_field(name="", value=f"Limit reached. {s['today']}/{s['limit']} used.\nResets midnight UTC."))
    if res.get("error") == "empty":
        return await send(embed=e().add_field(name="", value=f"`{cat}` out of stock."))

    try:
        dm = await user.create_dm()
        em = e()
        em.title = "Generated"
        em.description = f"```\n{res['item']}\n```"
        em.add_field(name="Category", value=f"`{cat}`", inline=True)
        em.add_field(name="Remaining", value=f"`{res['left']}`", inline=True)
        await dm.send(embed=em)
        await send(embed=e().add_field(name="", value=f"Sent to DMs. {res['left']} left today."))
    except Exception:
        await send(embed=e().add_field(name="", value="Could not DM you. Check your privacy settings."))


async def do_hotmail_check(ctx_or_inter, svc, accounts=None, is_slash=False):
    """Shared hotmail check logic."""
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        else:
            return await ctx_or_inter.send(**kw)

    if accounts is None:
        accounts = []
    accs = list(set(accounts))

    if not accs:
        return await send(embed=e().add_field(name="", value="No valid email:pass combos provided.\nPaste them or attach a .txt file."))
    if len(accs) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many accounts. Max {MAX_COMBO_LINES} lines."))

    tc = min(max(config.MAX_THREADS, 1), 30)
    label = svc["label"]
    msg = await send(embed=e().add_field(name="", value=f"Checking {len(accs)} accounts ({tc} threads)...\n\n`{bar(0, len(accs))}`"))

    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]
    live_hits = [0]
    live_fails = [0]

    def on_progress(done, total, status=None):
        if status == "hit":
            live_hits[0] += 1
        elif status and status not in ("2fa", "custom", "retry"):
            live_fails[0] += 1
        now = time.time()
        if now - last_edit[0] < 3:
            return
        last_edit[0] = now
        sec = now - t0
        cpm = round(done / (sec / 60)) if sec > 0 else 0
        em = e()
        em.description = (
            f"Checking {label}...\n\n`{bar(done, total)}`\n\n"
            f"CPM: `{cpm}` | Time: `{sec:.1f}s`\n"
            f"Valid: `{live_hits[0]}` | Invalid: `{live_fails[0]}`"
        )
        asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    results = await bot.loop.run_in_executor(
        None, lambda: check_hotmail_accounts(accs, svc["keyword"], tc, on_progress, stop)
    )

    active_stops.pop(str(user.id), None)

    hits, twofas, customs, fails = [], [], [], []
    for r in results:
        caps = " | ".join(f"{k}: {v}" for k, v in r.get("captures", {}).items())
        line = f"{r['user']}:{r['password']}"
        if caps:
            line += f" | {caps}"

        if r["status"] == "hit":
            hits.append(line)
        elif r["status"] == "2fa":
            twofas.append(f"{r['user']}:{r['password']} -> {r.get('detail', '2FA')}")
        elif r["status"] == "custom":
            customs.append(f"{r['user']}:{r['password']} -> {r.get('detail', '')}")
        else:
            fails.append(f"{r['user']}:{r['password']} -> {r.get('detail', 'fail')}")

    sec = time.time() - t0
    cpm = round(len(results) / (sec / 60)) if sec > 0 else 0

    re_em = e()
    re_em.title = f"{label} Check Results"
    re_em.add_field(name="Total", value=f"`{len(results)}`", inline=True)
    re_em.add_field(name="Hits", value=f"`{len(hits)}`", inline=True)
    re_em.add_field(name="2FA", value=f"`{len(twofas)}`", inline=True)
    re_em.add_field(name="Custom", value=f"`{len(customs)}`", inline=True)
    re_em.add_field(name="Failed", value=f"`{len(fails)}`", inline=True)
    re_em.add_field(name="CPM", value=f"`{cpm}`", inline=True)

    files = []
    if hits: files.append(txt_file(hits, f"{label}_Hits.txt"))
    if twofas: files.append(txt_file(twofas, f"{label}_2FA.txt"))
    if customs: files.append(txt_file(customs, f"{label}_Custom.txt"))
    if fails: files.append(txt_file(fails, f"{label}_Failed.txt"))

    try:
        dm = await user.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value=f"Done. {len(hits)} hits / {len(twofas)} 2FA / {len(fails)} failed. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)


# ── WLID Set ──

async def do_wlidset(ctx_or_inter, wlids_raw=None, wlids_file=None, is_slash=False):
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        return await ctx_or_inter.send(**kw)

    if not is_owner(user.id):
        return await send(embed=e().add_field(name="", value="Owner only."))

    wlids = []
    if wlids_raw:
        wlids.extend([l.strip() for l in wlids_raw.replace(",", "\n").splitlines() if l.strip()])
    if wlids_file:
        wlids.extend([l for l in await fetch_lines(wlids_file) if l.strip()])

    if not wlids:
        return await send(embed=e().add_field(name="", value="No WLID tokens provided."))

    set_wlids(wlids)
    await send(embed=e().add_field(name="", value=f"WLID tokens updated. **{len(wlids)}** stored."))


# ── WLID Claim ──

async def do_claim(ctx_or_inter, accounts_raw=None, accounts_file=None, threads=5, is_slash=False):
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        return await ctx_or_inter.send(**kw)

    accs = []
    if accounts_raw:
        parsed, dirty = extract_combos(accounts_raw)
        accs.extend(parsed)
        if dirty:
            await send(embed=e().add_field(name="", value="Captures/other data found.. extracting mails.."))
    if accounts_file:
        raw_lines = await fetch_lines(accounts_file)
        parsed, _ = extract_combos("\n".join(raw_lines))
        accs.extend(parsed)
    accs = list(set(accs))

    if not accs:
        return await send(embed=e().add_field(name="", value="No valid accounts provided (email:password)."))
    if len(accs) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many accounts. Max {MAX_COMBO_LINES} lines."))

    msg = await send(embed=e().add_field(name="", value=f"Claiming WLIDs from {len(accs)} accounts...\n\n`{bar(0, len(accs))}`"))
    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]

    def on_progress(done, total):
        now = time.time()
        if now - last_edit[0] < 2:
            return
        last_edit[0] = now
        sec = now - t0
        em = e()
        em.description = f"Claiming WLIDs...\n\n`{bar(done, total)}`\n\nTime: `{sec:.1f}s`"
        asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    results = await bot.loop.run_in_executor(
        None, lambda: claim_wlids(accs, threads, on_progress, stop)
    )
    active_stops.pop(str(user.id), None)

    success = [r for r in results if r.get("success") and r.get("token")]
    failed = [r for r in results if not r.get("success")]

    re_em = e()
    re_em.title = "Claim Results"
    re_em.add_field(name="Total", value=f"`{len(results)}`", inline=True)
    re_em.add_field(name="Success", value=f"`{len(success)}`", inline=True)
    re_em.add_field(name="Failed", value=f"`{len(failed)}`", inline=True)

    files = []
    if success:
        files.append(txt_file([r["token"] for r in success], "tokens.txt"))
    if failed:
        files.append(txt_file([f"{r['email']}: {r.get('error', 'Unknown')}" for r in failed], "failed.txt"))

    try:
        dm = await user.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value=f"Done. {len(success)} tokens claimed. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)


# ── Code Check (with WLIDs) ──

async def do_code_check(ctx_or_inter, codes_raw=None, codes_file=None, wlids_raw=None, threads=10, is_slash=False):
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        return await ctx_or_inter.send(**kw)

    wlids = []
    if wlids_raw:
        wlids.extend([l.strip() for l in wlids_raw.replace(",", "\n").splitlines() if l.strip()])
    if not wlids:
        wlids = get_wlids()
    if not wlids:
        return await send(embed=e().add_field(name="", value="No WLIDs provided and none stored. Use `/wlidset` first."))

    codes = []
    if codes_raw:
        codes.extend([l.strip() for l in codes_raw.replace(",", "\n").splitlines() if l.strip()])
    if codes_file:
        codes.extend([l for l in await fetch_lines(codes_file) if l.strip()])
    if not codes:
        return await send(embed=e().add_field(name="", value="No codes provided."))
    if len(codes) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many codes. Max {MAX_COMBO_LINES} lines."))

    msg = await send(embed=e().add_field(name="", value=f"Checking {len(codes)} codes ({len(wlids)} WLIDs)...\n\n`{bar(0, len(codes))}`"))
    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]

    def on_progress(done, total, _last=None):
        now = time.time()
        if now - last_edit[0] < 2:
            return
        last_edit[0] = now
        sec = now - t0
        em = e()
        em.description = f"Checking codes...\n\n`{bar(done, total)}`\n\nTime: `{sec:.1f}s`"
        asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    results = await bot.loop.run_in_executor(
        None, lambda: check_codes(wlids, codes, threads, on_progress, stop)
    )
    active_stops.pop(str(user.id), None)

    valid = [r for r in results if r.get("status") == "valid"]
    used = [r for r in results if r.get("status") == "used"]
    expired = [r for r in results if r.get("status") == "expired"]
    invalid = [r for r in results if r.get("status") in ("invalid", "error")]

    re_em = e()
    re_em.title = "Code Check Results"
    re_em.add_field(name="Total", value=f"`{len(results)}`", inline=True)
    re_em.add_field(name="Valid", value=f"`{len(valid)}`", inline=True)
    re_em.add_field(name="Used", value=f"`{len(used)}`", inline=True)
    re_em.add_field(name="Expired", value=f"`{len(expired)}`", inline=True)
    re_em.add_field(name="Invalid", value=f"`{len(invalid)}`", inline=True)

    files = []
    if valid: files.append(txt_file([f"{r['code']} | {r.get('title', '')}" for r in valid], "valid.txt"))
    if used: files.append(txt_file([r["code"] for r in used], "used.txt"))
    if expired: files.append(txt_file([f"{r['code']} | {r.get('title', '')}" for r in expired], "expired.txt"))
    if invalid: files.append(txt_file([r["code"] for r in invalid], "invalid.txt"))

    try:
        dm = await user.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value="Done. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)


# ── Pull (codes from Game Pass) ──

async def do_pull(ctx_or_inter, accounts_raw=None, accounts_file=None, is_slash=False):
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        return await ctx_or_inter.send(**kw)

    accs = []
    if accounts_raw:
        parsed, dirty = extract_combos(accounts_raw)
        accs.extend(parsed)
        if dirty:
            await send(embed=e().add_field(name="", value="Captures/other data found.. extracting mails.."))
    if accounts_file:
        raw_lines = await fetch_lines(accounts_file)
        parsed, _ = extract_combos("\n".join(raw_lines))
        accs.extend(parsed)
    accs = list(set(accs))

    if not accs:
        return await send(embed=e().add_field(name="", value="No valid accounts provided (email:password)."))
    if len(accs) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many accounts. Max {MAX_COMBO_LINES} lines."))

    msg = await send(embed=e().add_field(name="", value=f"Pulling codes from {len(accs)} accounts...\n\n`{bar(0, len(accs))}`"))
    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]
    fetch_done = [0]
    fetch_codes_count = [0]
    fetch_working = [0]
    fetch_failed = [0]

    def on_progress(phase, detail):
        now = time.time()
        if phase == "fetch":
            fetch_done[0] = detail.get("done", 0)
            fetch_codes_count[0] += detail.get("codes", 0)
            if detail.get("error"):
                fetch_failed[0] += 1
            else:
                fetch_working[0] += 1
            if now - last_edit[0] < 2:
                return
            last_edit[0] = now
            em = e()
            em.description = (
                f"Pulling codes...\n\n`{bar(fetch_done[0], detail['total'])}`\n\n"
                f"Working: `{fetch_working[0]}` | Failed: `{fetch_failed[0]}` | Codes: `{fetch_codes_count[0]}`"
            )
            asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)
        elif phase == "validate_start":
            em = e()
            em.description = f"Validating {detail['total']} codes..."
            asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)
        elif phase == "validate":
            if now - last_edit[0] < 2:
                return
            last_edit[0] = now
            em = e()
            em.description = f"Validating codes...\n\n`{bar(detail['done'], detail['total'])}`"
            asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    result = await bot.loop.run_in_executor(
        None, lambda: pull_codes(accs, on_progress, stop)
    )
    active_stops.pop(str(user.id), None)

    fetch_results = result["fetch_results"]
    validate_results = result["validate_results"]
    elapsed = f"{time.time() - t0:.1f}s"

    valid = [r for r in validate_results if r.get("status") == "valid"]
    used = [r for r in validate_results if r.get("status") == "used"]
    expired = [r for r in validate_results if r.get("status") == "expired"]
    invalid = [r for r in validate_results if r.get("status") in ("invalid", "error")]
    total_codes = sum(len(fr.get("codes", [])) for fr in fetch_results)
    working = sum(1 for fr in fetch_results if not fr.get("error"))
    failed = sum(1 for fr in fetch_results if fr.get("error"))

    re_em = e()
    re_em.title = "Pull Results"
    re_em.add_field(name="Accounts", value=f"`{len(fetch_results)}`", inline=True)
    re_em.add_field(name="Working", value=f"`{working}`", inline=True)
    re_em.add_field(name="Failed", value=f"`{failed}`", inline=True)
    re_em.add_field(name="Codes Found", value=f"`{total_codes}`", inline=True)
    re_em.add_field(name="Valid", value=f"`{len(valid)}`", inline=True)
    re_em.add_field(name="Used", value=f"`{len(used)}`", inline=True)
    re_em.add_field(name="Elapsed", value=f"`{elapsed}`", inline=True)

    files = []
    if valid: files.append(txt_file([f"{r['code']} | {r.get('title', '')}" for r in valid], "valid.txt"))
    if used: files.append(txt_file([r["code"] for r in used], "used.txt"))
    if expired: files.append(txt_file([r["code"] for r in expired], "expired.txt"))

    try:
        dm = await user.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value=f"Done. {len(valid)} valid codes. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)


# ── Promo Puller (links only) ──

async def do_promopuller(ctx_or_inter, accounts_raw=None, accounts_file=None, is_slash=False):
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        return await ctx_or_inter.send(**kw)

    accs = []
    if accounts_raw:
        parsed, _ = extract_combos(accounts_raw)
        accs.extend(parsed)
    if accounts_file:
        raw_lines = await fetch_lines(accounts_file)
        parsed, _ = extract_combos("\n".join(raw_lines))
        accs.extend(parsed)
    accs = list(set(accs))

    if not accs:
        return await send(embed=e().add_field(name="", value="No valid accounts provided."))
    if len(accs) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many accounts. Max {MAX_COMBO_LINES} lines."))

    msg = await send(embed=e().add_field(name="", value=f"Pulling promo links from {len(accs)} accounts...\n\n`{bar(0, len(accs))}`"))
    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]

    def on_progress(phase, detail):
        now = time.time()
        if now - last_edit[0] < 2:
            return
        last_edit[0] = now
        if phase == "fetch":
            em = e()
            em.description = f"Pulling links...\n\n`{bar(detail['done'], detail['total'])}`"
            asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    result = await bot.loop.run_in_executor(
        None, lambda: pull_links(accs, on_progress, stop)
    )
    active_stops.pop(str(user.id), None)

    all_links = result["all_links"]
    fetch_results = result["fetch_results"]
    unique_links = list(set(all_links))
    elapsed = f"{time.time() - t0:.1f}s"

    re_em = e()
    re_em.title = "Promo Puller Results"
    re_em.add_field(name="Accounts", value=f"`{len(fetch_results)}`", inline=True)
    re_em.add_field(name="Links Found", value=f"`{len(all_links)}`", inline=True)
    re_em.add_field(name="Unique", value=f"`{len(unique_links)}`", inline=True)
    re_em.add_field(name="Elapsed", value=f"`{elapsed}`", inline=True)

    files = []
    if all_links: files.append(txt_file(all_links, "links_all.txt"))
    if unique_links and len(unique_links) != len(all_links):
        files.append(txt_file(unique_links, "links_unique.txt"))

    try:
        dm = await user.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value=f"Done. {len(unique_links)} unique links. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)





async def do_inboxaio(ctx_or_inter, accounts_raw=None, accounts_file=None, threads=5, is_slash=False):
    user = ctx_or_inter.user if is_slash else ctx_or_inter.author

    async def send(**kw):
        if is_slash:
            return await ctx_or_inter.followup.send(**kw)
        return await ctx_or_inter.send(**kw)

    accs = []
    if accounts_raw:
        parsed, dirty = extract_combos(accounts_raw)
        accs.extend(parsed)
        if dirty:
            await send(embed=e().add_field(name="", value="Captures/other data found.. extracting mails.."))
    if accounts_file:
        raw_lines = await fetch_lines(accounts_file)
        parsed, _ = extract_combos("\n".join(raw_lines))
        accs.extend(parsed)
    accs = list(set(accs))

    if not accs:
        return await send(embed=e().add_field(name="", value="No valid accounts provided."))
    if len(accs) > MAX_COMBO_LINES:
        return await send(embed=e().add_field(name="", value=f"Too many accounts. Max {MAX_COMBO_LINES} lines."))

    msg = await send(embed=e().add_field(name="", value=f"Scanning {len(accs)} inboxes ({get_service_count()} services)...\n\n`{'█' * 0}{'░' * 20}` 0%"))
    if is_slash and msg is None:
        msg = await ctx_or_inter.original_response()

    stop = threading.Event()
    active_stops[str(user.id)] = stop
    t0 = time.time()
    last_edit = [0]
    live_svc_breakdown = {}

    def on_progress(done, total, status=None, hits=0, fails=0, result=None):
        if result and result.get("services"):
            for svc_name in result["services"]:
                live_svc_breakdown[svc_name] = live_svc_breakdown.get(svc_name, 0) + 1
        now = time.time()
        if now - last_edit[0] < 2.5:
            return
        last_edit[0] = now
        sec = now - t0
        pct = int(done / total * 100) if total else 0
        filled = int(pct / 100 * 20)
        bar_str = "█" * filled + "░" * (20 - filled)

        em = e()
        block = [
            f"  Progress    [{bar_str}] {pct}%",
            f"  Processed   {done} / {total}",
            f"  Hits        {hits}",
            f"  Failed      {fails}",
            f"  Elapsed     {sec:.1f}s",
        ]
        em.description = f"```\n" + "\n".join(block) + "\n```"

        # Live services - paginated 20 per field
        if live_svc_breakdown:
            top = sorted(live_svc_breakdown.items(), key=lambda x: x[1], reverse=True)
            for page_idx in range(0, len(top), 20):
                page = top[page_idx:page_idx + 20]
                svc_text = "\n".join(f"◈ **{name}**: {count}" for name, count in page)
                page_num = page_idx // 20 + 1
                total_pages = (len(top) + 19) // 20
                label = f"┃ Services ({page_num})" if total_pages > 1 else "┃ Services"
                em.add_field(name=label, value=svc_text, inline=False)

        asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    results = await bot.loop.run_in_executor(
        None, lambda: check_inbox_accounts(accs, threads, on_progress, stop)
    )
    active_stops.pop(str(user.id), None)

    hit_results = [r for r in results if r.get("status") == "hit" and r.get("services")]
    fail_results = [r for r in results if r.get("status") != "hit"]
    locked_count = sum(1 for r in results if r.get("status") in ("2fa", "locked"))

    elapsed = f"{time.time() - t0:.1f}s"

    # Build service breakdown from all hits
    service_breakdown = {}
    for r in hit_results:
        for svc_name in r.get("services", {}):
            service_breakdown[svc_name] = service_breakdown.get(svc_name, 0) + 1

    re_em = e()
    re_em.title = "Inbox AIO  ─  Results"
    block = [
        f"  Total       {len(results)}",
        f"  Hits        {len(hit_results)}",
        f"  Failed      {len(fail_results)}",
        f"  Locked/2FA  {locked_count}",
        f"  Elapsed     {elapsed}",
    ]
    re_em.description = f"```\n" + "\n".join(block) + "\n```"

    if service_breakdown:
        top = sorted(service_breakdown.items(), key=lambda x: x[1], reverse=True)
        for page_idx in range(0, len(top), 20):
            page = top[page_idx:page_idx + 20]
            svc_text = "\n".join(f"◈ **{name}**: {count}" for name, count in page)
            page_num = page_idx // 20 + 1
            total_pages = (len(top) + 19) // 20
            label = f"┃ Services ({page_num})" if total_pages > 1 else "┃ Services"
            re_em.add_field(name=label, value=svc_text, inline=False)
    else:
        re_em.add_field(name="┃ Services", value="No services detected.", inline=False)

    # Build files by category
    files = []
    categories = {}
    for r in hit_results:
        for svc_name, svc_data in r.get("services", {}).items():
            cat = svc_data.get("category", "Other")
            if cat not in categories:
                categories[cat] = []
            snippet = svc_data.get("snippet", "")
            date = svc_data.get("date", "")
            line = f"{r['user']}:{r['password']} | {svc_name} ({svc_data.get('count', 0)} mails)"
            if date:
                line += f" | Last: {date}"
            if snippet:
                line += f" | {snippet[:80]}"
            categories[cat].append(line)

    for cat, lines in sorted(categories.items()):
        files.append(txt_file(lines, f"{cat}_hits.txt"))

    # Combined hits file
    if hit_results:
        combined = []
        for r in hit_results:
            svcs = ", ".join(r.get("services", {}).keys())
            caps = " | ".join(f"{k}: {v}" for k, v in r.get("captures", {}).items())
            line = f"{r['user']}:{r['password']} | Services: {svcs}"
            if caps:
                line += f" | {caps}"
            combined.append(line)
        files.append(txt_file(combined, "all_hits.txt"))

    try:
        dm = await user.create_dm()
        for i in range(0, len(files), 9):
            batch = files[i:i+9]
            if i == 0:
                await dm.send(embed=re_em, files=batch)
            else:
                await dm.send(files=batch)
        await msg.edit(embed=e().add_field(name="", value=f"Done. {len(hit_results)} hits / {len(service_breakdown)} services. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files[:10])


# ── Services map (for hotmail checker) ──
SERVICES = {
    "netflix": {"keyword": "netflix", "label": "Netflix"},
    "roblox": {"keyword": "roblox", "label": "Roblox"},
    "crunchyroll": {"keyword": "crunchyroll", "label": "Crunchyroll"},
}

# ═══════════════════════════════════════════════════════════════
#  SLASH COMMANDS
# ═══════════════════════════════════════════════════════════════

@bot.tree.command(name="xboxcheck", description="Check Xbox/Microsoft accounts (email:pass)")
@app_commands.describe(accounts="Accounts as email:pass (comma-separated)", accounts_file="Text file with email:pass per line", threads="Concurrent threads (1-50)")
async def slash_xboxcheck(interaction: discord.Interaction, accounts: str = None, accounts_file: discord.Attachment = None, threads: app_commands.Range[int, 1, 50] = None):
    await interaction.response.defer()
    accs = []
    if accounts:
        parsed, _ = extract_combos(accounts)
        accs.extend(parsed)
    if accounts_file:
        accs.extend([l for l in await fetch_lines(accounts_file) if ":" in l])
    await do_xbox_check(interaction, accs, threads or config.MAX_THREADS, is_slash=True)


@bot.tree.command(name="check", description="Check Microsoft/Hotmail accounts against a service")
@app_commands.describe(service="Service to check", accounts="Accounts as email:pass", accounts_file="Text file with email:pass per line")
@app_commands.choices(service=[
    app_commands.Choice(name="Netflix", value="netflix"),
    app_commands.Choice(name="Roblox", value="roblox"),
    app_commands.Choice(name="Crunchyroll", value="crunchyroll"),
])
async def slash_check(interaction: discord.Interaction, service: app_commands.Choice[str], accounts: str = None, accounts_file: discord.Attachment = None):
    await interaction.response.defer()
    svc = SERVICES.get(service.value)
    if not svc:
        return await interaction.followup.send(embed=e().add_field(name="", value="Unknown service."))
    accs = []
    if accounts:
        parsed, _ = extract_combos(accounts)
        accs.extend(parsed)
    if accounts_file:
        accs.extend([l for l in await fetch_lines(accounts_file) if ":" in l])
    await do_hotmail_check(interaction, svc, accs, is_slash=True)


@bot.tree.command(name="wlidset", description="[ADMIN] Set WLID tokens for code checking")
@app_commands.describe(tokens="WLID tokens (comma-separated)", tokens_file="Text file with tokens")
async def slash_wlidset(interaction: discord.Interaction, tokens: str = None, tokens_file: discord.Attachment = None):
    await interaction.response.defer()
    await do_wlidset(interaction, tokens, tokens_file, is_slash=True)


@bot.tree.command(name="claim", description="Claim WLID tokens from Microsoft accounts")
@app_commands.describe(accounts="Accounts as email:pass", accounts_file="Text file with email:pass", threads="Concurrent threads (1-10)")
async def slash_claim(interaction: discord.Interaction, accounts: str = None, accounts_file: discord.Attachment = None, threads: app_commands.Range[int, 1, 10] = 5):
    await interaction.response.defer()
    await do_claim(interaction, accounts, accounts_file, threads, is_slash=True)


@bot.tree.command(name="codecheck", description="Check codes using stored WLIDs")
@app_commands.describe(codes="Codes to check (comma-separated)", codes_file="Text file with codes", wlids="WLID tokens (optional, uses stored)", threads="Concurrent threads (1-50)")
async def slash_codecheck(interaction: discord.Interaction, codes: str = None, codes_file: discord.Attachment = None, wlids: str = None, threads: app_commands.Range[int, 1, 50] = 10):
    await interaction.response.defer()
    await do_code_check(interaction, codes, codes_file, wlids, threads, is_slash=True)


@bot.tree.command(name="pull", description="Pull Game Pass perk codes from accounts")
@app_commands.describe(accounts="Accounts as email:pass", accounts_file="Text file with email:pass")
async def slash_pull(interaction: discord.Interaction, accounts: str = None, accounts_file: discord.Attachment = None):
    await interaction.response.defer()
    await do_pull(interaction, accounts, accounts_file, is_slash=True)


@bot.tree.command(name="promopuller", description="Pull promo links from Game Pass accounts")
@app_commands.describe(accounts="Accounts as email:pass", accounts_file="Text file with email:pass")
async def slash_promopuller(interaction: discord.Interaction, accounts: str = None, accounts_file: discord.Attachment = None):
    await interaction.response.defer()
    await do_promopuller(interaction, accounts, accounts_file, is_slash=True)




@bot.tree.command(name="inboxaio", description=f"Scan Hotmail/Outlook inboxes for {get_service_count()}+ services")
@app_commands.describe(accounts="Accounts as email:pass", accounts_file="Text file with email:pass", threads="Concurrent threads (1-10)")
async def slash_inboxaio(interaction: discord.Interaction, accounts: str = None, accounts_file: discord.Attachment = None, threads: app_commands.Range[int, 1, 10] = 5):
    await interaction.response.defer()
    await do_inboxaio(interaction, accounts, accounts_file, threads, is_slash=True)


@bot.tree.command(name="gen", description="Generate an item from a category")
@app_commands.describe(category="Category name")
async def slash_gen(interaction: discord.Interaction, category: str = None):
    await interaction.response.defer()
    await do_gen(interaction, category, is_slash=True)


@bot.tree.command(name="stock", description="View stock counts for all categories")
async def slash_stock(interaction: discord.Interaction):
    await interaction.response.defer()
    cats = gen.get_categories()
    if not cats:
        return await interaction.followup.send(embed=e().add_field(name="", value="No categories."))
    st = gen.all_stock_counts()
    total = sum(st.values())
    lines = "\n".join(f"`{c}` — `{st[c]}`" for c in cats)
    await interaction.followup.send(embed=e().add_field(name="Stock", value=lines + f"\n\nTotal: `{total}`"))


@bot.tree.command(name="restock", description="[ADMIN] Add stock to a category")
@app_commands.describe(category="Category name", stock_file="Text file with items (one per line)")
async def slash_restock(interaction: discord.Interaction, category: str, stock_file: discord.Attachment):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    if not gen.category_exists(category):
        return await interaction.followup.send(embed=e().add_field(name="", value=f"`{category}` doesn't exist."))
    lines = await fetch_lines(stock_file)
    if not lines:
        return await interaction.followup.send(embed=e().add_field(name="", value="Empty file."))
    added = gen.add_stock(category, lines)
    await interaction.followup.send(embed=e().add_field(name="", value=f"+{added} to `{category}`. Total: `{gen.stock_count(category)}`"))


@bot.tree.command(name="addcategory", description="[ADMIN] Create a new gen category")
@app_commands.describe(name="Category name")
async def slash_addcategory(interaction: discord.Interaction, name: str):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    if gen.add_category(name):
        await interaction.followup.send(embed=e().add_field(name="", value=f"`{name.lower()}` created."))
    else:
        await interaction.followup.send(embed=e().add_field(name="", value=f"`{name.lower()}` already exists."))


@bot.tree.command(name="removecategory", description="[ADMIN] Delete a gen category")
@app_commands.describe(name="Category name")
async def slash_removecategory(interaction: discord.Interaction, name: str):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    if gen.remove_category(name):
        await interaction.followup.send(embed=e().add_field(name="", value=f"`{name.lower()}` removed."))
    else:
        await interaction.followup.send(embed=e().add_field(name="", value=f"`{name.lower()}` not found."))


@bot.tree.command(name="clearstock", description="[ADMIN] Wipe all stock from a category")
@app_commands.describe(category="Category name")
async def slash_clearstock(interaction: discord.Interaction, category: str):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    if not gen.category_exists(category):
        return await interaction.followup.send(embed=e().add_field(name="", value="Invalid category."))
    gen.clear_stock(category)
    await interaction.followup.send(embed=e().add_field(name="", value=f"Cleared `{category}`."))


@bot.tree.command(name="stats", description="View user stats")
@app_commands.describe(user="User to check (default: yourself)")
async def slash_stats(interaction: discord.Interaction, user: discord.User = None):
    await interaction.response.defer()
    uid = str(user.id) if user else str(interaction.user.id)
    s = gen.stats(uid)
    tier = "Premium" if s["premium"] else "Free"
    hist = "\n".join(f"  {k}: {v}" for k, v in s["history"].items())
    em = e()
    em.title = "Stats"
    em.add_field(name="User", value=f"<@{uid}>", inline=True)
    em.add_field(name="Tier", value=f"`{tier}`", inline=True)
    em.add_field(name="Daily", value=f"`{s['today']}/{s['limit']}`", inline=True)
    em.add_field(name="Left", value=f"`{s['remaining']}`", inline=True)
    em.add_field(name="All Time", value=f"`{s['total']}`", inline=True)
    if hist:
        em.description = f"```\n{hist}\n```"
    await interaction.followup.send(embed=em)


@bot.tree.command(name="addpremium", description="[ADMIN] Grant premium to a user")
@app_commands.describe(user="User to add")
async def slash_addpremium(interaction: discord.Interaction, user: discord.User):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    gen.add_premium(str(user.id))
    await interaction.followup.send(embed=e().add_field(name="", value=f"<@{user.id}> added to premium."))


@bot.tree.command(name="removepremium", description="[ADMIN] Revoke premium from a user")
@app_commands.describe(user="User to remove")
async def slash_removepremium(interaction: discord.Interaction, user: discord.User):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    gen.remove_premium(str(user.id))
    await interaction.followup.send(embed=e().add_field(name="", value=f"<@{user.id}> removed from premium."))


@bot.tree.command(name="premiumlist", description="[ADMIN] List all premium users")
async def slash_premiumlist(interaction: discord.Interaction):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    users = gen.premium_list()
    if not users:
        return await interaction.followup.send(embed=e().add_field(name="", value="None."))
    lines = "\n".join(f"`{i+1}.` <@{u}>" for i, u in enumerate(users))
    await interaction.followup.send(embed=e().add_field(name="Premium Users", value=lines))


@bot.tree.command(name="setfree", description="[ADMIN] Set daily free generation limit")
@app_commands.describe(limit="Daily limit")
async def slash_setfree(interaction: discord.Interaction, limit: app_commands.Range[int, 1, 1000]):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    gen.set_free_limit(limit)
    await interaction.followup.send(embed=e().add_field(name="", value=f"Free limit: `{limit}/day`"))


@bot.tree.command(name="setpremium_limit", description="[ADMIN] Set daily premium generation limit")
@app_commands.describe(limit="Daily limit")
async def slash_setpremium(interaction: discord.Interaction, limit: app_commands.Range[int, 1, 10000]):
    await interaction.response.defer()
    if not is_owner(interaction.user.id):
        return await interaction.followup.send(embed=e().add_field(name="", value="Owner only."))
    gen.set_premium_limit(limit)
    await interaction.followup.send(embed=e().add_field(name="", value=f"Premium limit: `{limit}/day`"))


@bot.tree.command(name="stop", description="Stop your currently running task")
async def slash_stop(interaction: discord.Interaction):
    await interaction.response.defer()
    ev = active_stops.get(str(interaction.user.id))
    if ev:
        ev.set()
        active_stops.pop(str(interaction.user.id), None)
        await interaction.followup.send(embed=e().add_field(name="", value="Stopped."))
    else:
        await interaction.followup.send(embed=e().add_field(name="", value="Nothing running."))


@bot.tree.command(name="help", description="Show all available commands")
async def slash_help(interaction: discord.Interaction):
    await interaction.response.defer()
    p = config.PREFIX
    lines = [
        "```",
        "GENERATOR",
        f"  /gen <category>         Generate (DM)",
        f"  /gen                    List categories",
        f"  /stock                  Stock counts",
        f"  /stats [@user]          User stats",
        "",
        "ADMIN",
        f"  /addcategory <name>     New category",
        f"  /removecategory <name>  Delete category",
        f"  /restock <cat> + file   Add stock",
        f"  /clearstock <cat>       Wipe stock",
        f"  /addpremium <@user>     Grant premium",
        f"  /removepremium <@user>  Revoke premium",
        f"  /premiumlist            Premium users",
        f"  /setfree <n>            Free daily cap",
        f"  /setpremium_limit <n>   Premium daily cap",
        "",
        "XBOX",
        f"  /xboxcheck + file       Check accounts",
        "",
        "CHECKER",
        f"  /check netflix + file   Service checker",
        f"  /codecheck + file       Check codes (WLIDs)",
        "",
        "TOOLS",
        f"  /claim + file           Claim WLID tokens",
        f"  /pull + file            Pull Game Pass codes",
        f"  /promopuller + file     Pull promo links",
        f"  /inboxaio + file        Scan inbox (156 svcs)",
        f"  /wlidset + tokens       Set WLID tokens",
        f"  /stop                   Stop running task",
        "",
        f"Prefix commands also work with '{p}'",
        f"Free: {gen.free_limit}/day  |  Premium: {gen.premium_limit}/day",
        "Resets midnight UTC",
        "```",
    ]
    await interaction.followup.send(embed=e().add_field(name="Commands", value="\n".join(lines)))


# ═══════════════════════════════════════════════════════════════
#  PREFIX COMMANDS
# ═══════════════════════════════════════════════════════════════

@bot.command(name="xboxcheck")
async def cmd_xboxcheck(ctx, *, raw=""):
    accs = [l.strip() for l in raw.replace(",", "\n").splitlines() if ":" in l.strip()]
    for att in ctx.message.attachments:
        accs.extend([l for l in await fetch_lines(att) if ":" in l])
    await do_xbox_check(ctx, accs, config.MAX_THREADS)

@bot.command(name="xboxhelp")
async def cmd_xboxhelp(ctx):
    await ctx.send(embed=e().add_field(name="Xbox Checker", value=f"`{config.PREFIX}xboxcheck` with email:pass combos.\nAttach .txt for bulk. Results via DM."))

@bot.command(name="gen")
async def cmd_gen(ctx, cat=None):
    await do_gen(ctx, cat)

@bot.command(name="stock")
async def cmd_stock(ctx):
    cats = gen.get_categories()
    if not cats:
        return await ctx.send(embed=e().add_field(name="", value="No categories."))
    st = gen.all_stock_counts()
    total = sum(st.values())
    lines = "\n".join(f"`{c}` — `{st[c]}`" for c in cats)
    await ctx.send(embed=e().add_field(name="Stock", value=lines + f"\n\nTotal: `{total}`"))

@bot.command(name="restock")
async def cmd_restock(ctx, cat=None):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    if not cat:
        return await ctx.send(embed=e().add_field(name="", value="Specify a category."))
    if not gen.category_exists(cat):
        return await ctx.send(embed=e().add_field(name="", value=f"`{cat}` doesn't exist."))
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    if not att:
        return await ctx.send(embed=e().add_field(name="", value="Attach a .txt file."))
    lines = await fetch_lines(att)
    if not lines:
        return await ctx.send(embed=e().add_field(name="", value="Empty file."))
    added = gen.add_stock(cat, lines)
    await ctx.send(embed=e().add_field(name="", value=f"+{added} to `{cat}`. Total: `{gen.stock_count(cat)}`"))

@bot.command(name="addcategory")
async def cmd_addcat(ctx, name=None):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    if not name:
        return await ctx.send(embed=e().add_field(name="", value="Specify a name."))
    if gen.add_category(name):
        await ctx.send(embed=e().add_field(name="", value=f"`{name.lower()}` created."))
    else:
        await ctx.send(embed=e().add_field(name="", value=f"`{name.lower()}` already exists."))

@bot.command(name="removecategory")
async def cmd_rmcat(ctx, name=None):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    if not name:
        return await ctx.send(embed=e().add_field(name="", value="Specify a name."))
    if gen.remove_category(name):
        await ctx.send(embed=e().add_field(name="", value=f"`{name.lower()}` removed."))
    else:
        await ctx.send(embed=e().add_field(name="", value=f"`{name.lower()}` not found."))

@bot.command(name="clearstock")
async def cmd_clearstock(ctx, cat=None):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    if not cat or not gen.category_exists(cat):
        return await ctx.send(embed=e().add_field(name="", value="Invalid category."))
    gen.clear_stock(cat)
    await ctx.send(embed=e().add_field(name="", value=f"Cleared `{cat}`."))

@bot.command(name="stats")
async def cmd_stats(ctx, target=None):
    uid = parse_uid(target) or str(ctx.author.id)
    s = gen.stats(uid)
    tier = "Premium" if s["premium"] else "Free"
    hist = "\n".join(f"  {k}: {v}" for k, v in s["history"].items())
    em = e()
    em.title = "Stats"
    em.add_field(name="User", value=f"<@{uid}>", inline=True)
    em.add_field(name="Tier", value=f"`{tier}`", inline=True)
    em.add_field(name="Daily", value=f"`{s['today']}/{s['limit']}`", inline=True)
    em.add_field(name="Left", value=f"`{s['remaining']}`", inline=True)
    em.add_field(name="All Time", value=f"`{s['total']}`", inline=True)
    if hist:
        em.description = f"```\n{hist}\n```"
    await ctx.send(embed=em)

@bot.command(name="addpremium")
async def cmd_addprem(ctx, target=None):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    uid = parse_uid(target)
    if not uid:
        return await ctx.send(embed=e().add_field(name="", value="Mention a user."))
    gen.add_premium(uid)
    await ctx.send(embed=e().add_field(name="", value=f"<@{uid}> added to premium."))

@bot.command(name="removepremium")
async def cmd_rmprem(ctx, target=None):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    uid = parse_uid(target)
    if not uid:
        return await ctx.send(embed=e().add_field(name="", value="Mention a user."))
    gen.remove_premium(uid)
    await ctx.send(embed=e().add_field(name="", value=f"<@{uid}> removed from premium."))

@bot.command(name="premiumlist")
async def cmd_premlist(ctx):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    users = gen.premium_list()
    if not users:
        return await ctx.send(embed=e().add_field(name="", value="None."))
    lines = "\n".join(f"`{i+1}.` <@{u}>" for i, u in enumerate(users))
    await ctx.send(embed=e().add_field(name="Premium Users", value=lines))

@bot.command(name="setfree")
async def cmd_setfree(ctx, n: int = 0):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    if n < 1:
        return await ctx.send(embed=e().add_field(name="", value="Invalid number."))
    gen.set_free_limit(n)
    await ctx.send(embed=e().add_field(name="", value=f"Free limit: `{n}/day`"))

@bot.command(name="setpremium")
async def cmd_setprem(ctx, n: int = 0):
    if not is_owner(ctx.author.id):
        return await ctx.send(embed=e().add_field(name="", value="Owner only."))
    if n < 1:
        return await ctx.send(embed=e().add_field(name="", value="Invalid number."))
    gen.set_premium_limit(n)
    await ctx.send(embed=e().add_field(name="", value=f"Premium limit: `{n}/day`"))


# ── New prefix commands ──

@bot.command(name="wlidset")
async def cmd_wlidset(ctx, *, raw=""):
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    await do_wlidset(ctx, raw or None, att)

@bot.command(name="claim")
async def cmd_claim(ctx, *, raw=""):
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    await do_claim(ctx, raw or None, att)

@bot.command(name="codecheck")
async def cmd_codecheck(ctx, *, raw=""):
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    await do_code_check(ctx, raw or None, att)

@bot.command(name="pull")
async def cmd_pull(ctx, *, raw=""):
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    await do_pull(ctx, raw or None, att)

@bot.command(name="promopuller")
async def cmd_promopuller(ctx, *, raw=""):
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    await do_promopuller(ctx, raw or None, att)


@bot.command(name="inboxaio")
async def cmd_inboxaio(ctx, *, raw=""):
    att = ctx.message.attachments[0] if ctx.message.attachments else None
    await do_inboxaio(ctx, raw or None, att)


# ── Hotmail checkers (prefix) ──

@bot.command(name="check")
async def cmd_check(ctx, service=None):
    if not service:
        em = e()
        em.title = "Available Services"
        svc_list = "\n".join(f"`{k}` — {v['label']} checker" for k, v in SERVICES.items())
        em.description = f"Usage: `/check <service>` or `{config.PREFIX}check <service>` + attach mail:pass .txt\n\n{svc_list}"
        return await ctx.send(embed=em)

    service = service.lower().strip()
    if service not in SERVICES:
        return await ctx.send(embed=e().add_field(name="", value=f"Unknown service `{service}`. Use `{config.PREFIX}check` to see available."))

    raw = ctx.message.content.split(None, 2)
    raw_text = raw[2] if len(raw) > 2 else ""
    accs = [l.strip() for l in raw_text.replace(",", "\n").splitlines() if ":" in l.strip()]
    for att in ctx.message.attachments:
        accs.extend([l for l in await fetch_lines(att) if ":" in l])

    await do_hotmail_check(ctx, SERVICES[service], accs)


@bot.command(name="stop")
async def cmd_stop(ctx):
    ev = active_stops.get(str(ctx.author.id))
    if ev:
        ev.set()
        active_stops.pop(str(ctx.author.id), None)
        await ctx.send(embed=e().add_field(name="", value="Stopped."))
    else:
        await ctx.send(embed=e().add_field(name="", value="Nothing running."))

@bot.command(name="help")
async def cmd_help(ctx):
    p = config.PREFIX
    lines = [
        "```",
        "GENERATOR",
        f"  {p}gen <category>        Generate (DM)",
        f"  {p}gen                   List categories",
        f"  {p}stock                 Stock counts",
        f"  {p}stats [@user|id]      User stats",
        "",
        "ADMIN",
        f"  {p}addcategory <name>    New category",
        f"  {p}removecategory <name> Delete category",
        f"  {p}restock <cat> + .txt  Add stock",
        f"  {p}clearstock <cat>      Wipe stock",
        f"  {p}addpremium <@user>    Grant premium",
        f"  {p}removepremium <@user> Revoke premium",
        f"  {p}premiumlist           Premium users",
        f"  {p}setfree <n>           Free daily cap",
        f"  {p}setpremium <n>        Premium daily cap",
        "",
        "XBOX",
        f"  {p}xboxcheck + .txt      Check accounts",
        f"  {p}xboxhelp              Checker help",
        "",
        "CHECKER",
        f"  {p}check netflix + .txt  Service checker",
        f"  {p}check roblox + .txt   Roblox checker",
        f"  {p}check crunchyroll     Crunchyroll checker",
        f"  {p}codecheck + .txt      Check codes (WLIDs)",
        "",
        "TOOLS",
        f"  {p}claim + .txt          Claim WLID tokens",
        f"  {p}pull + .txt           Pull Game Pass codes",
        f"  {p}promopuller + .txt    Pull promo links",
        f"  {p}inboxaio + .txt       Scan inbox (156 svcs)",
        f"  {p}wlidset + tokens      Set WLID tokens",
        f"  {p}stop                  Stop running task",
        "",
        "All commands also work as /slash commands",
        f"Free: {gen.free_limit}/day  |  Premium: {gen.premium_limit}/day",
        "Resets midnight UTC",
        "```",
    ]
    await ctx.send(embed=e().add_field(name="Commands", value="\n".join(lines)))


# ═══════════════════════════════════════════════════════════════
#  EVENTS
# ═══════════════════════════════════════════════════════════════

@bot.event
async def on_ready():
    print(f"{bot.user} online | {len(bot.guilds)} guilds")
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} slash commands")
    except Exception as ex:
        print(f"Failed to sync slash commands: {ex}")
    await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.watching, name=f"/help"))


bot.run(config.BOT_TOKEN)
