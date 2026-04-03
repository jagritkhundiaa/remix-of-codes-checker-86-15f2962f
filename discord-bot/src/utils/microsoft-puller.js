// ============================================================
//  Xbox Code Fetcher + Validator (PrepareRedeem)
//  100% exact same logic as the Python script, ported to Node.js
//  Now also runs PRS (Rewards Scraper) in parallel per account
// ============================================================

const crypto = require("crypto");
const { checkCodes } = require("./microsoft-checker");
const { getWlids } = require("./wlid-store");
const { proxiedFetch } = require("./proxy-manager");
const { scrapeRewards } = require("./microsoft-rewards-scraper");

// ── Code Format Validation (exact match to Python) ───────────

const INVALID_CHARS = new Set(["A", "E", "I", "O", "U", "L", "S", "0", "1", "5"]);

function isInvalidCodeFormat(code) {
  if (!code || code.length < 5 || code.includes(" ")) return true;
  for (const char of code) {
    if (INVALID_CHARS.has(char)) return true;
  }
  return false;
}

// ── Cookie-aware fetch (preserves cookies across redirects like Python requests.Session) ──

function extractCookiesFromResponse(res, cookieJar) {
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const parts = c.split(";")[0].trim();
    if (parts.includes("=")) {
      cookieJar.push(parts);
    }
  }
}

function getCookieString(cookieJar) {
  return cookieJar.join("; ");
}

async function sessionFetch(url, options, cookieJar) {
  // Manual redirect following to preserve cookies (like Python requests.Session)
  let currentUrl = url;
  let method = options.method || "GET";
  let body = options.body;
  let maxRedirects = 15;

  while (maxRedirects-- > 0) {
    const res = await proxiedFetch(currentUrl, {
      ...options,
      method,
      body,
      headers: {
        ...options.headers,
        Cookie: getCookieString(cookieJar),
      },
      redirect: "manual",
    });

    extractCookiesFromResponse(res, cookieJar);

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).href;
      // Redirects become GET (except 307/308)
      if (status !== 307 && status !== 308) {
        method = "GET";
        body = undefined;
      }
      // Consume body to avoid memory leaks
      try { await res.text(); } catch {}
      continue;
    }

    // Return with the final URL attached
    const text = await res.text();
    return { res, text, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// ── Xbox Live OAuth Login ────────────────────────────────────

const MICROSOFT_OAUTH_URL =
  "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

async function fetchOAuthTokens(session) {
  try {
    const { text } = await sessionFetch(MICROSOFT_OAUTH_URL, {
      headers: session.headers,
    }, session.cookies);

    let match = text.match(/value=\\?"(.+?)\\?"/s) || text.match(/value="(.+?)"/s);
    if (!match) return { urlPost: null, ppft: null };
    const ppft = match[1];

    match = text.match(/"urlPost":"(.+?)"/s) || text.match(/urlPost:'(.+?)'/s);
    if (!match) return { urlPost: null, ppft: null };

    return { urlPost: match[1], ppft };
  } catch {
    return { urlPost: null, ppft: null };
  }
}

async function fetchLogin(session, email, password, urlPost, ppft) {
  try {
    const body = new URLSearchParams({
      login: email,
      loginfmt: email,
      passwd: password,
      PPFT: ppft,
    });

    const { text, finalUrl } = await sessionFetch(urlPost, {
      method: "POST",
      headers: {
        ...session.headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }, session.cookies);

    // Check if final URL has access_token in fragment
    if (finalUrl.includes("#")) {
      const hash = new URL(finalUrl).hash.substring(1);
      const params = new URLSearchParams(hash);
      const token = params.get("access_token");
      if (token && token !== "None") return token;
    }

    if (text.includes("cancel?mkt=")) {
      const iptMatch = text.match(/(?<="ipt" value=").+?(?=">)/);
      const ppridMatch = text.match(/(?<="pprid" value=").+?(?=">)/);
      const uaidMatch = text.match(/(?<="uaid" value=").+?(?=">)/);
      const actionMatch = text.match(/(?<=id="fmHF" action=").+?(?=" )/);

      if (iptMatch && ppridMatch && uaidMatch && actionMatch) {
        const formBody = new URLSearchParams({
          ipt: iptMatch[0],
          pprid: ppridMatch[0],
          uaid: uaidMatch[0],
        });

        const { text: retText } = await sessionFetch(actionMatch[0], {
          method: "POST",
          headers: {
            ...session.headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody.toString(),
        }, session.cookies);

        const returnUrlMatch = retText.match(
          /(?<="recoveryCancel":\{"returnUrl":")(.+?)(?=",)/
        );
        if (returnUrlMatch) {
          const { finalUrl: finUrl } = await sessionFetch(returnUrlMatch[0], {
            headers: session.headers,
          }, session.cookies);
          if (finUrl.includes("#")) {
            const hash = new URL(finUrl).hash.substring(1);
            const params = new URLSearchParams(hash);
            const token = params.get("access_token");
            if (token && token !== "None") return token;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
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

function generateMsCv() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let cv = "";
  for (let i = 0; i < 22; i++) cv += chars[Math.floor(Math.random() * chars.length)];
  return cv + ".0";
}

async function fetchCodesFromXbox(uhs, xstsToken) {
  try {
    const auth = `XBL3.0 x=${uhs};${xstsToken}`;
    const codes = [];
    const links = [];

    // Headers matching Xbox Game Pass app
    const baseHeaders = {
      Authorization: auth,
      "Content-Type": "application/json",
      "User-Agent": "XboxGamePassDesktop/2502.1001.30.0",
      "Accept": "application/json",
      "Accept-Language": "en-US",
      "x-xbl-contract-version": "2",
    };

    // Try v3 first, then v2
    let data = null;
    for (const version of ["v3", "v2"]) {
      try {
        const res = await proxiedFetch(`https://profile.gamepass.com/${version}/offers`, {
          headers: baseHeaders,
        });
        if (res.status === 200) {
          data = await res.json();
          break;
        }
      } catch {}
    }

    if (!data) return { codes, links };

    // Handle both response formats: data.offers (v2) or data directly as array (v3)
    const offers = data.offers || data.perks || data.results || (Array.isArray(data) ? data : []);

    for (const offer of offers) {
      // Extract resource from multiple possible fields
      const resource = offer.resource || offer.code || offer.redeemUrl || offer.claimUrl || offer.benefitUrl || offer.url || null;

      if (resource) {
        if (isLink(resource)) {
          links.push(resource);
        } else {
          codes.push(resource);
        }
        continue;
      }

      // If no resource yet, try claiming — check multiple status fields
      const status = offer.offerStatus || offer.status || offer.state || "";
      const canClaim = ["available", "unclaimed", "ready", "Active"].some(
        s => status.toLowerCase() === s.toLowerCase()
      );

      if (!canClaim) continue;

      const offerId = offer.offerId || offer.id || offer.perkId || offer.offerProductId;
      if (!offerId) continue;

      // Try claiming on both v3 and v2
      for (const version of ["v3", "v2"]) {
        try {
          const claimRes = await proxiedFetch(
            `https://profile.gamepass.com/${version}/offers/${offerId}`,
            {
              method: "POST",
              headers: {
                ...baseHeaders,
                "ms-cv": generateMsCv(),
                "Content-Length": "0",
              },
              body: "",
            }
          );
          if (claimRes.status === 200) {
            const claimData = await claimRes.json();
            const claimedResource = claimData.resource || claimData.code || claimData.redeemUrl
              || claimData.claimUrl || claimData.benefitUrl || claimData.url || null;
            if (claimedResource) {
              if (isLink(claimedResource)) {
                links.push(claimedResource);
              } else {
                codes.push(claimedResource);
              }
              break; // Claimed successfully, don't try other version
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
  const session = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    cookies: [], // Array-based cookie jar for proper tracking
  };

  try {
    const { urlPost, ppft } = await fetchOAuthTokens(session);
    if (!urlPost) return { email, codes: [], links: [], error: "OAuth failed" };

    const rps = await fetchLogin(session, email, password, urlPost, ppft);
    if (!rps) return { email, codes: [], links: [], error: "Login failed" };

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
 * Full pull pipeline:
 *   Phase 1 — Fetch codes from Game Pass perks (normal puller)
 *   Phase 2 — PRS recheck (runs AFTER Phase 1 completes, sequential)
 *   Phase 3 — Validate all codes using WLID checker
 */
async function pullCodes(accounts, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const threads = Math.min(parsed.length, 10);

  // ── Phase 1: Normal Puller — fetch codes from Game Pass perks ──
  const allCodes = [];
  const fetchResults = [];
  let fetchDone = 0;

  async function fetchWorker() {
    while (true) {
      if (signal && signal.aborted) break;
      const idx = fetchDone++;
      if (idx >= parsed.length) break;
      const { email, password } = parsed[idx];
      const gpResult = await fetchFromAccount(email, password);
      const gpCodes = gpResult.codes || [];

      fetchResults.push({ email: gpResult.email, codes: [...gpCodes], links: gpResult.links || [], error: gpResult.error });
      allCodes.push(...gpCodes);

      if (onProgress)
        onProgress("fetch", {
          email,
          codes: gpCodes.length,
          error: gpResult.error,
          done: fetchResults.length,
          total: parsed.length,
        });
    }
  }

  fetchDone = 0;
  const fetchWorkers = Array(Math.min(threads, parsed.length)).fill(null).map(() => fetchWorker());
  await Promise.all(fetchWorkers);

  if (signal && signal.aborted) return { fetchResults, validateResults: [] };

  // ── Phase 2: PRS recheck — runs AFTER Phase 1 completes ──
  // UI shows "Checking if no code is left..."
  if (onProgress) onProgress("recheck_start", { total: parsed.length });

  const gpCodeSet = new Set(allCodes);
  let recheckDone = 0;

  async function recheckWorker() {
    while (true) {
      if (signal && signal.aborted) break;
      const idx = recheckDone++;
      if (idx >= parsed.length) break;
      const { email, password } = parsed[idx];

      try {
        const prsResult = await scrapeRewards([`${email}:${password}`], "All", 1, null, signal);
        const prsCodes = (prsResult.allCodes || [])
          .map(c => c.code)
          .filter(c => c && /Z$/i.test(c) && !gpCodeSet.has(c));

        if (prsCodes.length > 0) {
          // Merge PRS codes into fetchResults + allCodes
          const existing = fetchResults.find(r => r.email === email);
          if (existing) {
            existing.codes.push(...prsCodes);
          }
          allCodes.push(...prsCodes);
          for (const c of prsCodes) gpCodeSet.add(c);
        }
      } catch {}

      if (onProgress)
        onProgress("recheck", { done: idx + 1, total: parsed.length });
    }
  }

  recheckDone = 0;
  const recheckWorkers = Array(Math.min(threads, parsed.length)).fill(null).map(() => recheckWorker());
  await Promise.all(recheckWorkers);

  if (signal && signal.aborted) return { fetchResults, validateResults: [] };
  if (allCodes.length === 0) return { fetchResults, validateResults: [] };

  // ── Phase 3: Validate using WLID checker ──
  const wlids = getWlids();
  if (wlids.length === 0) {
    const validateResults = allCodes.map((c) => ({ code: c, status: "error", message: `${c} | No WLIDs stored — use .wlidset first` }));
    return { fetchResults, validateResults };
  }

  if (onProgress) onProgress("validate_start", { total: allCodes.length, fetchResults });

  const validateResults = await checkCodes(wlids, allCodes, 10, (done, total, lastResult) => {
    if (onProgress) onProgress("validate", { done, total, status: lastResult?.status });
  }, signal);

  return { fetchResults, validateResults };
}

/**
 * Pull links only (promo links from Game Pass perks). No validation phase.
 */
async function pullLinks(accounts, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const threads = Math.min(parsed.length, 10);
  const allLinks = [];
  const fetchResults = [];
  let fetchDone = 0;

  async function fetchWorker() {
    while (true) {
      if (signal && signal.aborted) break;
      const idx = fetchDone++;
      if (idx >= parsed.length) break;
      const { email, password } = parsed[idx];
      const result = await fetchFromAccount(email, password);
      // For promopuller, only track links
      fetchResults.push({ email: result.email, links: result.links, error: result.error });
      allLinks.push(...result.links);
      if (onProgress)
        onProgress("fetch", {
          email,
          links: result.links.length,
          error: result.error,
          done: fetchResults.length,
          total: parsed.length,
        });
    }
  }

  fetchDone = 0;
  const fetchWorkers = Array(Math.min(threads, parsed.length)).fill(null).map(() => fetchWorker());
  await Promise.all(fetchWorkers);

  return { fetchResults, allLinks };
}

module.exports = { pullCodes, pullLinks, fetchFromAccount, validateCodesWithStore };
