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
from hotmail_checker import check_hotmail_accounts

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

# ── Shared logic ──

async def do_xbox_check(ctx_or_inter, accounts, threads, is_slash=False):
    """Shared Xbox check logic for both prefix and slash commands."""
    accounts = list(set(accounts))

    async def send(embed=None, files=None, **kw):
        if is_slash:
            if files:
                await ctx_or_inter.followup.send(embed=embed, files=files, **kw)
            else:
                await ctx_or_inter.followup.send(embed=embed, **kw)
        else:
            if files:
                await ctx_or_inter.send(embed=embed, files=files, **kw)
            else:
                await ctx_or_inter.send(embed=embed, **kw)

    if not accounts:
        return await send(embed=e().add_field(name="", value="No valid email:pass combos provided."))

    tc = min(max(threads or config.MAX_THREADS, 1), 50)
    total_accounts = len(accounts)
    msg = await send(embed=e().add_field(name="", value=(
        f"Starting check on {total_accounts} accounts ({tc} threads)...\n"
        "Warm-up can take up to 30s before first completed result.\n\n"
        f"`{bar(0, total_accounts)}`"
    )))

    # For slash commands followup.send returns the message
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

    # Build account list
    if accounts is None:
        accounts = []
    accs = list(set(accounts))

    if not accs:
        return await send(embed=e().add_field(name="", value="No valid email:pass combos provided.\nPaste them or attach a .txt file."))

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


# ── Services map ──
SERVICES = {
    "netflix": {"keyword": "netflix", "label": "Netflix"},
    "roblox": {"keyword": "roblox", "label": "Roblox"},
    "crunchyroll": {"keyword": "crunchyroll", "label": "Crunchyroll"},
}

# ═══════════════════════════════════════════════════════════════
#  SLASH COMMANDS
# ═══════════════════════════════════════════════════════════════

@bot.tree.command(name="xboxcheck", description="Check Xbox/Microsoft accounts (email:pass)")
@app_commands.describe(
    accounts="Accounts as email:pass (comma-separated)",
    accounts_file="Text file with email:pass per line",
    threads="Concurrent threads (1-50)"
)
async def slash_xboxcheck(
    interaction: discord.Interaction,
    accounts: str = None,
    accounts_file: discord.Attachment = None,
    threads: app_commands.Range[int, 1, 50] = None
):
    await interaction.response.defer()
    accs = []
    if accounts:
        accs.extend([l.strip() for l in accounts.replace(",", "\n").splitlines() if ":" in l.strip()])
    if accounts_file:
        accs.extend([l for l in await fetch_lines(accounts_file) if ":" in l])
    await do_xbox_check(interaction, accs, threads or config.MAX_THREADS, is_slash=True)


@bot.tree.command(name="check", description="Check Microsoft/Hotmail accounts against a service")
@app_commands.describe(
    service="Service to check (netflix, roblox, crunchyroll)",
    accounts="Accounts as email:pass (comma-separated)",
    accounts_file="Text file with email:pass per line"
)
@app_commands.choices(service=[
    app_commands.Choice(name="Netflix", value="netflix"),
    app_commands.Choice(name="Roblox", value="roblox"),
    app_commands.Choice(name="Crunchyroll", value="crunchyroll"),
])
async def slash_check(
    interaction: discord.Interaction,
    service: app_commands.Choice[str],
    accounts: str = None,
    accounts_file: discord.Attachment = None,
):
    await interaction.response.defer()
    svc = SERVICES.get(service.value)
    if not svc:
        return await interaction.followup.send(embed=e().add_field(name="", value="Unknown service."))
    accs = []
    if accounts:
        accs.extend([l.strip() for l in accounts.replace(",", "\n").splitlines() if ":" in l.strip()])
    if accounts_file:
        accs.extend([l for l in await fetch_lines(accounts_file) if ":" in l])
    await do_hotmail_check(interaction, svc, accs, is_slash=True)


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
async def slash_restock(
    interaction: discord.Interaction,
    category: str,
    stock_file: discord.Attachment
):
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
        f"  /check netflix + file   Netflix checker",
        f"  /check roblox + file    Roblox checker",
        f"  /check crunchyroll      Crunchyroll checker",
        f"  /stop                   Stop running task",
        "",
        f"Prefix commands also work with '{p}'",
        f"Free: {gen.free_limit}/day  |  Premium: {gen.premium_limit}/day",
        "Resets midnight UTC",
        "```",
    ]
    await interaction.followup.send(embed=e().add_field(name="Commands", value="\n".join(lines)))


# ═══════════════════════════════════════════════════════════════
#  PREFIX COMMANDS (kept as-is for backward compat)
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

    # Parse accounts from message
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
        f"  {p}check netflix + .txt  Netflix checker",
        f"  {p}check roblox + .txt   Roblox checker",
        f"  {p}check crunchyroll     Crunchyroll checker",
        f"  {p}check                 List services",
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
