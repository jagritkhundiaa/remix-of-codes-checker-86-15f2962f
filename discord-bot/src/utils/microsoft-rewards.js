// ============================================================
//  Microsoft Rewards Balance Checker
//  Logs into Microsoft accounts via account.microsoft.com
//  and checks Rewards point balance using the internal API
//  (Matches Gody.py approach)
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const LOGIN_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Content-Type": "application/x-www-form-urlencoded",
  "Origin": "https://login.live.com",
  "Referer": "https://login.live.com/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ── Cookie jar helper ──
class CookieJar {
  constructor() { this.cookies = {}; }

  extractFromHeaders(headers) {
    const setCookies = headers.getSetCookie?.() || [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) {
        const name = pair.substring(0, idx).trim();
        const value = pair.substring(idx + 1).trim();
        this.cookies[name] = value;
      }
    }
  }

  toString() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ── Session fetch with manual redirect following ──
async function sessionFetch(url, options, cookieJar, maxRedirects = 15) {
  let currentUrl = url;
  let redirects = 0;
  let res;

  while (redirects < maxRedirects) {
    const fetchOpts = {
      ...options,
      redirect: "manual",
      headers: {
        ...(options.headers || {}),
        Cookie: cookieJar.toString(),
      },
    };

    res = await proxiedFetch(currentUrl, fetchOpts);
    cookieJar.extractFromHeaders(res.headers);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      // Switch to GET after redirect
      delete fetchOpts.body;
      options = { ...options, method: "GET", body: undefined };
      redirects++;
      continue;
    }

    // Handle auto-submit forms (fmHF, etc.)
    const text = await res.text();
    const fmHFMatch = text.match(/name="fmHF"[^>]*action="([^"]+)"/);
    if (fmHFMatch) {
      const formAction = fmHFMatch[1];
      const inputs = [...text.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
      if (inputs.length > 0) {
        const formData = inputs.map(([, n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`).join("&");
        options = {
          method: "POST",
          headers: { ...LOGIN_HEADERS, "Referer": currentUrl },
          body: formData,
        };
        currentUrl = formAction;
        redirects++;
        continue;
      }
    }

    // Return text directly since we already consumed the body
    return { res, text };
  }

  const text = await res.text();
  return { res, text };
}

/**
 * Login to Microsoft and reach account.microsoft.com with authenticated session
 * Uses the same flow as Gody.py: login.live.com/ppsecure/post.srf → account.microsoft.com
 */
async function loginMicrosoft(email, password) {
  const cookieJar = new CookieJar();

  try {
    // Step 1: Hit login page to get PPFT and urlPost
    const loginPageRes = await proxiedFetch("https://login.live.com/ppsecure/post.srf", {
      redirect: "manual",
      headers: { ...DEFAULT_HEADERS, Cookie: cookieJar.toString() },
    });
    cookieJar.extractFromHeaders(loginPageRes.headers);

    // Follow redirects
    let currentRes = loginPageRes;
    let html;
    let hops = 0;
    while (currentRes.status >= 300 && currentRes.status < 400 && hops < 5) {
      const loc = currentRes.headers.get("location");
      if (!loc) break;
      currentRes = await proxiedFetch(loc, {
        redirect: "manual",
        headers: { ...DEFAULT_HEADERS, Cookie: cookieJar.toString() },
      });
      cookieJar.extractFromHeaders(currentRes.headers);
      hops++;
    }
    html = await currentRes.text();

    // Extract PPFT from ServerData or HTML
    let ppft = null;
    let urlPost = null;

    // Try ServerData JSON first
    const serverDataMatch = html.match(/var ServerData = ({.*?});/s);
    if (serverDataMatch) {
      try {
        const serverData = JSON.parse(serverDataMatch[1]);
        if (serverData.sFTTag) {
          const ppftMatch = serverData.sFTTag.match(/value="([^"]+)"/);
          if (ppftMatch) ppft = ppftMatch[1];
        }
        if (serverData.urlPost) urlPost = serverData.urlPost;
      } catch {}
    }

    // Fallback regex extraction
    if (!ppft) {
      const ppftMatch = html.match(/"sFTTag":"[^"]*value=\\"([^"\\]+)\\"/);
      if (ppftMatch) ppft = ppftMatch[1];
    }
    if (!ppft) {
      const ppftMatch = html.match(/name="PPFT"[^>]*value="([^"]+)"/);
      if (ppftMatch) ppft = ppftMatch[1];
    }
    if (!urlPost) {
      const urlPostMatch = html.match(/"urlPost":"([^"]+)"/);
      if (urlPostMatch) urlPost = urlPostMatch[1];
    }
    if (!urlPost) {
      const urlPostMatch = html.match(/urlPost:'([^']+)'/);
      if (urlPostMatch) urlPost = urlPostMatch[1];
    }

    if (!ppft || !urlPost) {
      return { success: false, error: "Failed to get login tokens (PPFT/urlPost)" };
    }

    // Step 2: Submit credentials
    const loginBody = `i13=0&login=${encodeURIComponent(email)}&loginfmt=${encodeURIComponent(email)}&type=11&LoginOptions=3&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd=${encodeURIComponent(password)}&ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=&PPFT=${encodeURIComponent(ppft)}&PPSX=PassportR&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i19=449894`;

    const { res: loginRes, text: loginText } = await sessionFetch(urlPost, {
      method: "POST",
      headers: LOGIN_HEADERS,
      body: loginBody,
    }, cookieJar);

    // Check for invalid creds
    if (loginText.toLowerCase().includes("password is incorrect") ||
        loginText.toLowerCase().includes("account doesn't exist") ||
        loginText.toLowerCase().includes("sign in to your microsoft account")) {
      return { success: false, error: "Invalid credentials" };
    }

    // Check 2FA
    if (loginText.includes("recover?mkt") ||
        loginText.includes("account.live.com/identity/confirm") ||
        loginText.includes("Email/Confirm?mkt") ||
        loginText.includes("/Abuse?mkt=")) {
      return { success: false, error: "2FA/Locked" };
    }

    // Handle KMSI (Keep Me Signed In) - urlPost second step
    let finalText = loginText;
    const urlPost2Match = loginText.match(/"urlPost":"([^"]+)"/) || loginText.match(/urlPost:'([^']+)'/);
    if (urlPost2Match) {
      const loginData2 = `LoginOptions=3&type=28&ctx=&hpgrequestid=&PPFT=${encodeURIComponent(ppft)}&i19=19130`;
      const { text: kmsiText } = await sessionFetch(urlPost2Match[1], {
        method: "POST",
        headers: { ...LOGIN_HEADERS, Referer: urlPost },
        body: loginData2,
      }, cookieJar);
      finalText = kmsiText;
    }

    // Handle any remaining fmHF forms (already handled by sessionFetch)

    // Step 3: Navigate to billing/payments to get __RequestVerificationToken
    const { text: billingText } = await sessionFetch(
      "https://account.microsoft.com/billing/payments?fref=home.drawers.payment-options.manage-payment&refd=account.microsoft.com",
      { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://account.microsoft.com/" } },
      cookieJar
    );

    const vrfMatch = billingText.match(/<input name="__RequestVerificationToken" type="hidden" value="([^"]+)"/);
    if (!vrfMatch) {
      return { success: false, error: "Could not get verification token (session may not be authenticated)" };
    }

    return {
      success: true,
      cookieJar,
      vrfToken: vrfMatch[1],
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch rewards balance from account.microsoft.com internal API
 * (Same as Gody.py: account.microsoft.com/rewards/api/pointsbalance)
 */
async function fetchRewardsBalance(cookieJar, vrfToken) {
  try {
    const res = await proxiedFetch("https://account.microsoft.com/rewards/api/pointsbalance", {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": UA,
        "__RequestVerificationToken": vrfToken,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieJar.toString(),
      },
    });

    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };

    const data = await res.json();
    const balance = data.balance || 0;

    return {
      success: true,
      balance,
      lifetimePoints: data.lifetimePoints || 0,
      level: data.level || "Unknown",
      levelName: data.levelName || "Unknown",
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check rewards balance for a single account
 */
async function checkRewardsAccount(email, password) {
  const loginResult = await loginMicrosoft(email, password);
  if (!loginResult.success) {
    return { email, success: false, error: loginResult.error };
  }

  const rewardsResult = await fetchRewardsBalance(loginResult.cookieJar, loginResult.vrfToken);
  if (!rewardsResult.success) {
    return { email, success: false, error: rewardsResult.error };
  }

  return {
    email,
    success: true,
    balance: rewardsResult.balance,
    lifetimePoints: rewardsResult.lifetimePoints,
    level: rewardsResult.level,
    levelName: rewardsResult.levelName,
  };
}

/**
 * Check rewards balances for multiple accounts
 * @param {string[]} accounts - Array of "email:password"
 * @param {number} threads - Concurrency
 * @param {Function} onProgress - (done, total) callback
 * @param {AbortSignal} signal - Optional abort signal
 */
async function checkRewardsBalances(accounts, threads = 3, onProgress, signal) {
  const results = [];
  let done = 0;

  const queue = [...accounts];

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const account = queue.shift();
      if (!account) break;

      const [email, password] = account.split(":");
      if (!email || !password) {
        results.push({ email: account, success: false, error: "Invalid format" });
        done++;
        onProgress?.(done, accounts.length);
        continue;
      }

      const result = await checkRewardsAccount(email.trim(), password.trim());
      results.push(result);
      done++;
      onProgress?.(done, accounts.length);
    }
  }

  const workers = Array.from({ length: Math.min(threads, accounts.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

module.exports = { checkRewardsBalances, checkRewardsAccount };
