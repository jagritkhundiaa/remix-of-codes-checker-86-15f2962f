"""
Microsoft Rewards Balance Checker — Python port of microsoft-rewards.js.
"""
import requests
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _login_microsoft(email, password):
    """Login and get authenticated cookies for rewards.bing.com."""
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    try:
        r = s.get("https://login.live.com/login.srf?wa=wsignin1.0&wreply=https://rewards.bing.com/signin",
                   allow_redirects=True, timeout=15)
        html = r.text

        import re
        ppft_m = re.search(r'name="PPFT".*?value="([^"]+)"', html)
        if not ppft_m:
            return {"success": False, "error": "Failed to get login token"}
        url_post_m = re.search(r"urlPost:\s*'([^']+)'", html)
        if not url_post_m:
            return {"success": False, "error": "Failed to get login URL"}

        r = s.post(url_post_m.group(1), data={
            "login": email, "loginfmt": email, "passwd": password,
            "PPFT": ppft_m.group(1), "PPSX": "PassportRN", "type": "11",
            "LoginOptions": "3", "NewUser": "1", "i21": "0",
            "CookieDisclosure": "0", "i19": "25069",
        }, headers={"Content-Type": "application/x-www-form-urlencoded"},
           allow_redirects=True, timeout=15)

        if "Your account or password is incorrect" in r.text or "Sign in to your account" in r.text:
            return {"success": False, "error": "Invalid credentials"}

        return {"success": True, "session": s}
    except Exception as ex:
        return {"success": False, "error": str(ex)}


def _fetch_rewards_balance(session):
    try:
        r = session.get("https://rewards.bing.com/api/getuserinfo?type=1",
                         headers={"Accept": "application/json"}, timeout=15)
        if not r.ok:
            return {"success": False, "error": f"HTTP {r.status_code}"}
        data = r.json()
        dash = data.get("dashboard", {})
        if not dash:
            return {"success": False, "error": "No rewards data"}
        us = dash.get("userStatus", {})
        streaks = dash.get("streaks", {})
        level_info = us.get("levelInfo", {})
        redeem_goal = us.get("redeemGoal", {})
        return {
            "success": True,
            "balance": us.get("availablePoints", 0),
            "lifetime_points": us.get("lifetimePoints", 0),
            "level": level_info.get("activeLevel", "Unknown"),
            "level_name": level_info.get("activeLevelName", "Unknown"),
            "streak": streaks.get("currentStreak", 0),
            "redeem_goal": redeem_goal.get("price", 0),
            "redeem_goal_name": redeem_goal.get("title", "None set"),
        }
    except Exception as ex:
        return {"success": False, "error": str(ex)}


def check_rewards_account(email, password):
    login = _login_microsoft(email, password)
    if not login["success"]:
        return {"email": email, "success": False, "error": login["error"]}
    rewards = _fetch_rewards_balance(login["session"])
    if not rewards["success"]:
        return {"email": email, "success": False, "error": rewards["error"]}
    return {"email": email, "success": True, **{k: v for k, v in rewards.items() if k != "success"}}


def check_rewards_balances(accounts, threads=3, on_progress=None, stop_event=None):
    results = []
    lock = threading.Lock()
    queue = list(accounts)
    idx = [0]

    def worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with lock:
                i = idx[0]
                idx[0] += 1
            if i >= len(queue):
                break
            acc = queue[i]
            parts = acc.split(":", 1)
            if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
                with lock:
                    results.append({"email": acc, "success": False, "error": "Invalid format"})
                if on_progress:
                    on_progress(len(results), len(queue))
                continue
            r = check_rewards_account(parts[0].strip(), parts[1].strip())
            with lock:
                results.append(r)
            if on_progress:
                on_progress(len(results), len(queue))

    wc = min(threads, len(queue))
    workers = []
    for _ in range(wc):
        t = threading.Thread(target=worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()
    return results
