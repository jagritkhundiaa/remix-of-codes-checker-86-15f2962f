"""
Microsoft Code Checker — checks codes using WLID tokens.
Exact same logic as the Node.js microsoft-checker.js.
"""
import requests
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

_title_cache = {}


def check_single_code(code, wlid):
    """Check a single code against Microsoft's API."""
    code = code.strip()
    if not code or len(code) < 18:
        return {"code": code, "status": "invalid"}

    for attempt in range(3):
        try:
            r = requests.get(
                f"https://purchase.mp.microsoft.com/v7.0/tokenDescriptions/{code}?market=US&language=en-US&supportMultiAvailabilities=true",
                headers={
                    "Authorization": wlid,
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Origin": "https://www.microsoft.com",
                    "Referer": "https://www.microsoft.com/",
                },
                timeout=30,
            )

            if r.status_code == 429:
                time.sleep(5)
                continue

            data = r.json()
            title = "N/A"

            if data.get("products") and len(data["products"]) > 0:
                product = data["products"][0]
                title = product.get("sku", {}).get("title") or product.get("title", "N/A")
                if title == "N/A":
                    lp = product.get("localizedProperties", [{}])
                    if lp:
                        title = lp[0].get("productTitle", "N/A")
            elif data.get("universalStoreBigIds") and len(data["universalStoreBigIds"]) > 0:
                parts = data["universalStoreBigIds"][0].split("/")
                product_id = parts[0]
                sku_id = parts[1] if len(parts) > 1 else ""

                if product_id in _title_cache:
                    title = _title_cache[product_id]
                else:
                    try:
                        cat_r = requests.get(
                            f"https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={product_id}&market=US&languages=en-US",
                            timeout=15,
                        )
                        if cat_r.status_code == 200:
                            cat_data = cat_r.json()
                            if cat_data.get("Products"):
                                p = cat_data["Products"][0]
                                if p.get("DisplaySkuAvailabilities"):
                                    for s in p["DisplaySkuAvailabilities"]:
                                        if s.get("Sku", {}).get("SkuId") == sku_id:
                                            lp = s["Sku"].get("LocalizedProperties", [{}])
                                            if lp:
                                                title = lp[0].get("SkuTitle") or lp[0].get("SkuDescription", "N/A")
                                            break
                                if title == "N/A" and p.get("LocalizedProperties"):
                                    title = p["LocalizedProperties"][0].get("ProductTitle", "N/A")
                                if title != "N/A":
                                    _title_cache[product_id] = title
                    except Exception:
                        title = f"ID: {product_id}"

            title = (title or "N/A").strip()

            ts = data.get("tokenState", "")
            if ts == "Active":
                return {"code": code, "status": "valid", "title": title}
            if ts == "Redeemed":
                return {"code": code, "status": "used", "title": title}
            if ts == "Expired":
                return {"code": code, "status": "expired", "title": title}
            if data.get("code") == "NotFound":
                return {"code": code, "status": "invalid"}
            if data.get("code") == "Unauthorized":
                return {"code": code, "status": "error", "error": "WLID unauthorized"}
            return {"code": code, "status": "invalid"}

        except Exception as ex:
            if attempt >= 2:
                return {"code": code, "status": "error", "error": str(ex)}
            time.sleep(1)

    return {"code": code, "status": "error", "error": "Max retries exceeded"}


def check_codes(wlids, codes, threads=10, on_progress=None, stop_event=None):
    """Check multiple codes using WLID tokens."""
    formatted = []
    for w in wlids:
        w = w.strip()
        if "WLID1.0=" not in w:
            w = f'WLID1.0="{w}"'
        formatted.append(w)

    MAX_PER_WLID = 40
    tasks = []
    for i, code in enumerate(codes):
        code = code.strip()
        if not code:
            continue
        wlid_idx = i // MAX_PER_WLID
        if wlid_idx >= len(formatted):
            break
        tasks.append({"code": code, "wlid": formatted[wlid_idx]})

    results = [None] * len(tasks)
    done = [0]
    lock = threading.Lock()

    def worker(idx):
        if stop_event and stop_event.is_set():
            return
        task = tasks[idx]
        results[idx] = check_single_code(task["code"], task["wlid"])
        with lock:
            done[0] += 1
            if on_progress and done[0] % 10 == 0:
                try:
                    on_progress(done[0], len(tasks), results[idx])
                except Exception:
                    pass

    concurrency = min(threads, 100, len(tasks))
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futs = {pool.submit(worker, i): i for i in range(len(tasks))}
        for f in as_completed(futs):
            try:
                f.result()
            except Exception:
                pass

    return [r for r in results if r]
