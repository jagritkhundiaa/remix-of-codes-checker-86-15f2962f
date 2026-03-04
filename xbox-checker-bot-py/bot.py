import discord
from discord.ext import commands
from discord import app_commands
import asyncio
import io
import time
import threading

import config
from checker import check_accounts
from gen_manager import GenManager
from netflix_mailpass_checker import check_netflix_accounts

intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix=config.PREFIX, intents=intents, help_command=None)
gen = GenManager()
active_stops = {}

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

async def fetch_lines(att):
    try:
        data = await att.read()
        return [l.strip() for l in data.decode("utf-8", errors="ignore").splitlines() if l.strip()]
    except Exception:
        return []

# xbox check

async def do_xbox_check(ctx, accounts, threads):
    accounts = list(set(accounts))
    if not accounts:
        return await ctx.send(embed=e().add_field(name="", value="No valid email:pass combos provided."))

    tc = min(max(threads or config.MAX_THREADS, 1), 50)
    msg = await ctx.send(embed=e().add_field(name="", value=f"Starting check on {len(accounts)} accounts ({tc} threads)...\n\n`{bar(0, len(accounts))}`"))

    stop = threading.Event()
    active_stops[str(ctx.author.id)] = stop
    t0 = time.time()
    last_edit = [0]

    def on_progress(done, total):
        now = time.time()
        if now - last_edit[0] < 3:
            return
        last_edit[0] = now
        sec = now - t0
        cpm = round(done / (sec / 60)) if sec > 0 else 0
        em = e()
        em.description = f"Checking...\n\n`{bar(done, total)}`\n\nCPM: {cpm} | {sec:.1f}s"
        asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    results = await bot.loop.run_in_executor(
        None, lambda: check_accounts(accounts, tc, on_progress, stop)
    )

    active_stops.pop(str(ctx.author.id), None)

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
        dm = await ctx.author.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value="Done. Results sent to DMs."))
    except Exception:
        await msg.edit(embed=re_em, files=files)

# gen handlers

async def do_gen(ctx, cat):
    uid = str(ctx.author.id)
    if not cat:
        cats = gen.get_categories()
        if not cats:
            return await ctx.send(embed=e().add_field(name="", value="No categories available."))
        st = gen.all_stock_counts()
        lines = "\n".join(f"`{c}` — {st[c]} in stock" for c in cats)
        return await ctx.send(embed=e().add_field(name="Categories", value=lines + f"\n\nUsage: `{config.PREFIX}gen <category>`"))

    res = gen.generate(uid, cat.lower())

    if res.get("error") == "not_found":
        return await ctx.send(embed=e().add_field(name="", value=f"Category `{cat}` not found."))
    if res.get("error") == "limit":
        s = gen.stats(uid)
        return await ctx.send(embed=e().add_field(name="", value=f"Limit reached. {s['today']}/{s['limit']} used.\nResets midnight UTC."))
    if res.get("error") == "empty":
        return await ctx.send(embed=e().add_field(name="", value=f"`{cat}` out of stock."))

    try:
        dm = await ctx.author.create_dm()
        em = e()
        em.title = "Generated"
        em.description = f"```\n{res['item']}\n```"
        em.add_field(name="Category", value=f"`{cat}`", inline=True)
        em.add_field(name="Remaining", value=f"`{res['left']}`", inline=True)
        await dm.send(embed=em)
        await ctx.send(embed=e().add_field(name="", value=f"Sent to DMs. {res['left']} left today."))
    except Exception:
        await ctx.send(embed=e().add_field(name="", value="Could not DM you. Check your privacy settings."))


# prefix commands

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

@bot.command(name="check")
async def cmd_check(ctx, service=None):
    if not service:
        em = e()
        em.title = "Available Services"
        em.description = f"Usage: `{config.PREFIX}check <service>` + attach mail:pass .txt files\n\n"
        em.description += "**Supported:**\n`netflix` — mail:pass login checker\n\n"
        em.description += "More services coming soon."
        return await ctx.send(embed=em)

    service = service.lower().strip()

    if service == "netflix":
        await do_netflix_mailpass_check(ctx)
    else:
        await ctx.send(embed=e().add_field(name="", value=f"Unknown service `{service}`. Use `{config.PREFIX}check` to see available services."))


async def do_netflix_mailpass_check(ctx):
    # Collect mail:pass combos from message text and attachments
    raw = ctx.message.content.split(None, 2)
    raw_text = raw[2] if len(raw) > 2 else ""
    accs = [l.strip() for l in raw_text.replace(",", "\n").splitlines() if ":" in l.strip()]
    for att in ctx.message.attachments:
        accs.extend([l for l in await fetch_lines(att) if ":" in l])

    accs = list(set(accs))
    if not accs:
        return await ctx.send(embed=e().add_field(name="", value="No valid email:pass combos provided.\nPaste them or attach a .txt file."))

    tc = min(max(config.MAX_THREADS, 1), 30)
    msg = await ctx.send(embed=e().add_field(name="", value=f"Checking {len(accs)} Netflix accounts ({tc} threads)...\n\n`{bar(0, len(accs))}`"))

    stop = threading.Event()
    active_stops[str(ctx.author.id)] = stop
    t0 = time.time()
    last_edit = [0]

    def on_progress(done, total):
        now = time.time()
        if now - last_edit[0] < 3:
            return
        last_edit[0] = now
        sec = now - t0
        cpm = round(done / (sec / 60)) if sec > 0 else 0
        em = e()
        em.description = f"Checking Netflix...\n\n`{bar(done, total)}`\n\nCPM: {cpm} | {sec:.1f}s"
        asyncio.run_coroutine_threadsafe(msg.edit(embed=em), bot.loop)

    results = await check_netflix_accounts(accs, max_concurrent=tc,
                                            on_progress=on_progress, stop_event=stop)

    active_stops.pop(str(ctx.author.id), None)

    hits, expired, custom, fails = [], [], [], []
    for r in results:
        caps = " | ".join(f"{k}: {v}" for k, v in r.get('captures', {}).items() if k != 'Cookie')
        line = f"{r['user']}:{r['password']}"
        if caps:
            line += f" | {caps}"

        if r['status'] == 'hit':
            hits.append(line)
        elif r['status'] == 'expired':
            expired.append(line)
        elif r['status'] == 'custom':
            custom.append(f"{line} -> {r.get('detail', '')}")
        else:
            fails.append(f"{r['user']}:{r['password']} -> {r.get('detail', 'fail')}")

    sec = time.time() - t0
    cpm = round(len(results) / (sec / 60)) if sec > 0 else 0

    re_em = e()
    re_em.title = "Netflix Check Results"
    re_em.add_field(name="Total", value=f"`{len(results)}`", inline=True)
    re_em.add_field(name="Hits", value=f"`{len(hits)}`", inline=True)
    re_em.add_field(name="Expired", value=f"`{len(expired)}`", inline=True)
    re_em.add_field(name="Custom", value=f"`{len(custom)}`", inline=True)
    re_em.add_field(name="Failed", value=f"`{len(fails)}`", inline=True)
    re_em.add_field(name="CPM", value=f"`{cpm}`", inline=True)

    files = []
    if hits: files.append(txt_file(hits, "Netflix_Hits.txt"))
    if expired: files.append(txt_file(expired, "Netflix_Expired.txt"))
    if custom: files.append(txt_file(custom, "Netflix_Custom.txt"))
    if fails: files.append(txt_file(fails, "Netflix_Failed.txt"))

    try:
        dm = await ctx.author.create_dm()
        await dm.send(embed=re_em, files=files)
        await msg.edit(embed=e().add_field(name="", value=f"Done. {len(hits)} hits / {len(expired)} expired / {len(fails)} failed. Results sent to DMs."))
    except:
        await msg.edit(embed=re_em, files=files)


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
        f"  {p}check <service>       Check mail:pass (.txt)",
        f"  {p}check                 List services",
        f"  {p}stop                  Stop running task",
        "",
        f"Free: {gen.free_limit}/day  |  Premium: {gen.premium_limit}/day",
        "Resets midnight UTC",
        "```",
    ]
    await ctx.send(embed=e().add_field(name="Commands", value="\n".join(lines)))


@bot.event
async def on_ready():
    print(f"{bot.user} online | {len(bot.guilds)} guilds")
    await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.watching, name=f"{config.PREFIX}help"))


bot.run(config.BOT_TOKEN)