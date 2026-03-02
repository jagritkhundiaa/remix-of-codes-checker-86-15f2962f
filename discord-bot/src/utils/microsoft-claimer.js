// ============================================================
//  Microsoft WLID Claimer — exact same logic as the edge function
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const TOKEN_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function decodeJsonString(text) {
  try { return JSON.parse(`"${text}"`); } catch { return text; }
}

function extractPattern(text, pattern) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

function extractAllMatches(text, pattern) {
  const matches = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] && match[2]) matches.push([match[1], match[2]]);
  }
  return matches;
}

class CookieJar {
  constructor() { this.cookies = new Map(); }

  extractFromHeaders(headers) {
    const raw = headers.raw?.()?.["set-cookie"];
    if (raw && Array.isArray(raw)) {
      for (const c of raw) this._parse(c);
      return;
    }
    const sc = headers.get("set-cookie");
    if (sc) {
      const parts = sc.split(/,(?=\s*[^;,]+=[^;,]+)/);
      for (const c of parts) this._parse(c);
    }
  }

  _parse(str) {
    const parts = str.split(";")[0].trim();
    const eq = parts.indexOf("=");
    if (eq > 0) {
      const name = parts.substring(0, eq).trim();
      const value = parts.substring(eq + 1).trim();
      if (name && value) this.cookies.set(name, value);
    }
  }

  toString() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name) { return this.cookies.get(name); }
}

async function fetchWithCookies(url, options, cookies) {
  let currentUrl = url;
  let maxRedirects = 10;

  while (maxRedirects > 0) {
    const headers = { ...(options.headers || {}), Cookie: cookies.toString() };
    const response = await proxiedFetch(currentUrl, { ...options, headers, redirect: "manual" });
    cookies.extractFromHeaders(response.headers);

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (location.startsWith("/")) {
        const u = new URL(currentUrl);
        currentUrl = `${u.origin}${location}`;
      } else if (!location.startsWith("http")) {
        const u = new URL(currentUrl);
        currentUrl = `${u.origin}/${location}`;
      } else {
        currentUrl = location;
      }
      maxRedirects--;
      options = { ...options, method: "GET", body: undefined };
      continue;
    }

    const text = await response.text();
    return { response, text, finalUrl: currentUrl };
  }
  throw new Error("Too many redirects");
}

const PATTERNS = {
  sftTag: /value=\\?"([^"\\]+)\\?"/s,
  urlPost: /"urlPost":"([^"]+)"/s,
  urlPostAlt: /urlPost:'([^']+)'/s,
  urlGoToAad: /urlGoToAADError":"([^"]+)"/,
  sftToken: /"sFT":"([^"]+)"/,
  formAction: /<form[^>]*action="([^"]+)"/,
  hiddenInputs: /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g,
  redirectUrl: /ucis\.RedirectUrl\s*=\s*'([^']+)'/,
  replaceUrl: /replace\("([^"]+)"\)/,
  formInputs: /<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g,
};

async function authenticateAccount(email, password) {
  const cookies = new CookieJar();

  try {
    // Step 1
    let result = await fetchWithCookies(
      "https://account.microsoft.com/billing/redeem",
      { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://account.microsoft.com/" } },
      cookies
    );
    let text = result.text;

    // Step 2
    const rurlMatch = extractPattern(text, PATTERNS.urlPost);
    if (!rurlMatch) throw new Error("Could not extract redirect URL");
    const rurl = "https://login.microsoftonline.com" + decodeJsonString(rurlMatch);
    result = await fetchWithCookies(rurl, { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://account.microsoft.com/" } }, cookies);
    text = result.text;

    // Step 3
    const furlMatch = extractPattern(text, PATTERNS.urlGoToAad);
    if (!furlMatch) throw new Error("Could not extract AAD URL");
    let furl = decodeJsonString(furlMatch);
    furl = furl.replace("&jshs=0", `&jshs=2&jsh=&jshp=&username=${encodeURIComponent(email)}&login_hint=${encodeURIComponent(email)}`);

    // Step 4
    result = await fetchWithCookies(furl, { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://login.microsoftonline.com/" } }, cookies);
    text = result.text;

    let sftTag = extractPattern(text, PATTERNS.sftTag);
    if (!sftTag) sftTag = extractPattern(text.replace(/\\/g, ""), PATTERNS.sftTag);
    if (!sftTag) { const m = text.match(/name="PPFT"[^>]+value="([^"]+)"/); if (m) sftTag = m[1]; }
    if (!sftTag) { const m = text.match(/value="([^"]+)"[^>]+name="PPFT"/); if (m) sftTag = m[1]; }
    if (!sftTag) throw new Error("Could not extract sFT tag");

    let urlPost = extractPattern(text, PATTERNS.urlPost);
    if (!urlPost) urlPost = extractPattern(text, PATTERNS.urlPostAlt);
    if (!urlPost) throw new Error("Could not extract urlPost");

    // Step 5
    const loginData = new URLSearchParams({ login: email, loginfmt: email, passwd: password, PPFT: sftTag });
    result = await fetchWithCookies(urlPost, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Referer: furl, Origin: "https://login.live.com" },
      body: loginData.toString(),
    }, cookies);
    let loginRequest = result.text.replace(/\\/g, "");

    if (loginRequest.includes("Your account or password is incorrect") || loginRequest.includes("sErrTxt")) {
      throw new Error("Invalid credentials");
    }

    // Step 6
    let ppftMatch = extractPattern(loginRequest, PATTERNS.sftToken);
    if (!ppftMatch) {
      const actionUrl = extractPattern(loginRequest, PATTERNS.formAction);
      if (actionUrl && actionUrl.includes("privacynotice")) {
        const inputMatches = extractAllMatches(loginRequest, PATTERNS.hiddenInputs);
        if (inputMatches.length > 0) {
          const formData = new URLSearchParams();
          for (const [name, value] of inputMatches) formData.append(name, value);
          result = await fetchWithCookies(actionUrl, {
            method: "POST", headers: { ...DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded" }, body: formData.toString(),
          }, cookies);
          const redirectUrlMatch = extractPattern(result.text, PATTERNS.redirectUrl);
          if (redirectUrlMatch) {
            const redirectUrl = redirectUrlMatch.replace(/u0026/g, "&").replace(/\\&/g, "&");
            result = await fetchWithCookies(redirectUrl, { method: "GET", headers: DEFAULT_HEADERS }, cookies);
            loginRequest = result.text.replace(/\\/g, "");
          }
        }
      }
      ppftMatch = extractPattern(loginRequest, PATTERNS.sftToken);
    }
    if (!ppftMatch) throw new Error("Could not extract second sFT token");

    // Step 7
    const lurlMatch = extractPattern(loginRequest, PATTERNS.urlPost);
    if (!lurlMatch) throw new Error("Could not extract final login URL");
    const finalLoginData = new URLSearchParams({ LoginOptions: "1", type: "28", ctx: "", hpgrequestid: "", PPFT: ppftMatch, canary: "" });
    result = await fetchWithCookies(lurlMatch, {
      method: "POST", headers: { ...DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded" }, body: finalLoginData.toString(),
    }, cookies);
    const finishText = result.text;

    // Step 8
    const reurlMatch = extractPattern(finishText, PATTERNS.replaceUrl);
    let reresp = finishText;
    if (reurlMatch) {
      result = await fetchWithCookies(reurlMatch, { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://login.live.com/" } }, cookies);
      reresp = result.text;
    }

    // Step 9
    const finalActionUrl = extractPattern(reresp, PATTERNS.formAction);
    if (finalActionUrl && !finalActionUrl.includes("javascript")) {
      let finalInputMatches = extractAllMatches(reresp, PATTERNS.formInputs);
      if (finalInputMatches.length === 0) {
        const altMatches = [];
        const regex = /<input[^>]+value="([^"]*)"[^>]+name="([^"]+)"/g;
        let match;
        while ((match = regex.exec(reresp)) !== null) altMatches.push([match[2], match[1]]);
        finalInputMatches = altMatches;
      }
      if (finalInputMatches.length > 0) {
        const finalFormData = new URLSearchParams();
        for (const [name, value] of finalInputMatches) finalFormData.append(name, value);
        result = await fetchWithCookies(finalActionUrl, {
          method: "POST", headers: { ...DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded" }, body: finalFormData.toString(),
        }, cookies);
      }
    }

    // Step 10
    const tokenResponse = await proxiedFetch("https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL", {
      method: "GET",
      headers: { ...TOKEN_HEADERS, "User-Agent": DEFAULT_HEADERS["User-Agent"], Referer: "https://account.microsoft.com/billing/redeem", Cookie: cookies.toString() },
    });

    const tokenText = await tokenResponse.text();
    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch { throw new Error("Invalid token response"); }
    if (!tokenData || !Array.isArray(tokenData) || !tokenData[0]?.token) throw new Error("Invalid token structure");

    return { email, success: true, token: tokenData[0].token };
  } catch (error) {
    return { email, success: false, error: String(error) };
  }
}

async function claimWlids(accounts, threads = 5, onProgress) {
  const parsedAccounts = accounts.map((acc) => {
    const i = acc.indexOf(":");
    return i === -1 ? { email: acc, password: "" } : { email: acc.substring(0, i), password: acc.substring(i + 1) };
  });

  const results = new Array(parsedAccounts.length);
  let currentIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const idx = currentIndex++;
      if (idx >= parsedAccounts.length) break;
      const { email, password } = parsedAccounts[idx];
      results[idx] = await authenticateAccount(email, password);
      completed++;
      if (onProgress) onProgress(completed, parsedAccounts.length);
    }
  }

  const workers = Array(Math.min(threads, parsedAccounts.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { claimWlids, authenticateAccount };
