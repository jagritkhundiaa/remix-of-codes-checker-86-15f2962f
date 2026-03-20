// ============================================================
//  Microsoft Store Purchaser
//  Two purchase flows:
//    1. Primary: WLID store checkout (buynow.production.store-web.dynamics.com)
//    2. Fallback: Xbox Live OAuth -> XBL3.0 -> purchase.xboxlive.com
//  Login reuses the exact same patterns as the Puller.
//  Supports accepting an external session to avoid duplicate logins.
// ============================================================

const crypto = require("crypto");
const { proxiedFetch } = require("./proxy-manager");

// ── Helpers ──────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";

const DEFAULT_HEADERS = {
  "User-Agent": UA,
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

const TOKEN_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// ── Cookie-aware session fetch (same as Puller) ─────────────

function extractCookiesFromResponse(res, cookieJar) {
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const parts = c.split(";")[0].trim();
    if (parts.includes("=")) {
      const name = parts.split("=")[0];
      const idx = cookieJar.findIndex(ck => ck.startsWith(name + "="));
      if (idx >= 0) cookieJar[idx] = parts;
      else cookieJar.push(parts);
    }
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
      if (status !== 307 && status !== 308) {
        method = "GET";
        body = undefined;
      }
      try { await res.text(); } catch {}
      continue;
    }

    const text = await res.text();

    // Handle meta/JS client-side redirects
    const metaRefresh = text.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)/i);
    if (metaRefresh) {
      currentUrl = new URL(metaRefresh[1], currentUrl).href;
      method = "GET";
      body = undefined;
      continue;
    }

    const jsRedirect = text.match(/(?:location\.replace|location\.href|window\.location)\s*[=(]\s*["']([^"']+)["']/);
    if (jsRedirect && !text.includes("<form")) {
      currentUrl = new URL(jsRedirect[1].replace(/\\/g, ""), currentUrl).href;
      method = "GET";
      body = undefined;
      continue;
    }

    // Handle auto-submit hidden forms (jsDisabled.srf etc.)
    const autoForm = text.match(/<form[^>]*action="([^"]+)"[^>]*>[\s\S]*?<\/form>/i);
    if (autoForm && (text.includes("document.forms[0].submit") || text.includes("jsDisabled"))) {
      const actionUrl = autoForm[1].replace(/&amp;/g, "&");
      const inputMatches = [...text.matchAll(/<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi)];
      const formData = new URLSearchParams();
      for (const m of inputMatches) formData.append(m[1], m[2]);
      currentUrl = new URL(actionUrl, currentUrl).href;
      method = "POST";
      body = formData.toString();
      options = { ...options, headers: { ...options.headers, "Content-Type": "application/x-www-form-urlencoded" } };
      continue;
    }

    return { res, text, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// ── Helper: retry wrapper ───────────────────────────────────

async function withRetry(fn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════════════════════
//  FLOW 1: WLID Store Login (same dynamic extraction as Puller)
// ═══════════════════════════════════════════════════════════════

async function loginToStore(email, password) {
  const cookieJar = [];

  try {
    console.log(`[PURCHASER] WLID login for ${email}`);

    // Step 1: Load login page to get PPFT + urlPost dynamically
    const initUrl = `https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=19&ct=${Math.floor(Date.now() / 1000)}&rver=7.0.6738.0&wp=MBI_SSL&wreply=https://account.microsoft.com/auth/complete-signin&lc=1033&id=292666&username=${encodeURIComponent(email)}`;

    const { text: loginPage } = await sessionFetch(initUrl, {
      headers: { ...DEFAULT_HEADERS },
    }, cookieJar);

    // Extract PPFT dynamically (multiple patterns)
    let ppft = "";
    let urlPost = "";

    const sFTTagMatch = loginPage.match(/"sFTTag":"[^"]*value=\\"([^"\\]+)\\"/);
    if (sFTTagMatch) ppft = sFTTagMatch[1];

    if (!ppft) {
      const m = loginPage.match(/name="PPFT"[^>]*value="([^"]+)"/);
      if (m) ppft = m[1];
    }
    if (!ppft) {
      try { ppft = loginPage.split('name="PPFT" id="i0327" value="')[1].split('"')[0]; } catch {}
    }

    const urlPostMatch = loginPage.match(/"urlPost":"([^"]+)"/);
    if (urlPostMatch) urlPost = urlPostMatch[1];
    if (!urlPost) {
      try { urlPost = loginPage.split("urlPost:'")[1].split("'")[0]; } catch {}
    }

    if (!ppft || !urlPost) {
      console.log(`[PURCHASER] Failed to extract PPFT/urlPost for ${email}`);
      return null;
    }

    // Step 2: Submit credentials
    const { text: loginText } = await sessionFetch(urlPost, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        i13: "1",
        login: email,
        loginfmt: email,
        type: "11",
        LoginOptions: "1",
        passwd: password,
        ps: "2",
        PPFT: ppft,
        PPSX: "PassportR",
        NewUser: "1",
        FoundMSAs: "",
        fspost: "0",
        i21: "0",
        CookieDisclosure: "0",
        IsFidoSupported: "0",
        isSignupPost: "0",
        isRecoveryAttemptPost: "0",
        i19: "9960",
      }).toString(),
    }, cookieJar);

    // Check for login errors
    const cleaned = loginText.replace(/\\/g, "");
    if (cleaned.includes("sErrTxt") || cleaned.includes("account or password is incorrect") || cleaned.includes("doesn't exist")) {
      console.log(`[PURCHASER] Bad credentials for ${email}`);
      return null;
    }
    if (cleaned.includes("identity/confirm") || cleaned.includes("Abuse")) {
      console.log(`[PURCHASER] Account locked/MFA for ${email}`);
      return null;
    }

    // Step 3: Handle redirect chain / hidden forms
    const reurlMatch = cleaned.match(/replace\("([^"]+)"/);
    if (reurlMatch) {
      try {
        await sessionFetch(reurlMatch[1], {
          headers: { ...DEFAULT_HEADERS },
        }, cookieJar);
      } catch {}
    }

    // Step 4: Warmup -- visit store pages to stabilize session
    try {
      await proxiedFetch("https://account.microsoft.com/billing/redeem", {
        headers: { ...DEFAULT_HEADERS, Cookie: getCookieString(cookieJar) },
        redirect: "manual",
      });
    } catch {}

    try {
      await proxiedFetch("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", {
        headers: { ...DEFAULT_HEADERS, Cookie: getCookieString(cookieJar) },
      });
    } catch {}

    // Step 5: Acquire store auth token
    const tokenResponse = await proxiedFetch(
      "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
      {
        headers: {
          ...TOKEN_HEADERS,
          "User-Agent": UA,
          Referer: "https://account.microsoft.com/billing/redeem",
          Cookie: getCookieString(cookieJar),
        },
      }
    );

    if (tokenResponse.status !== 200) {
      console.log(`[PURCHASER] Token request returned ${tokenResponse.status} for ${email}`);
      return null;
    }

    const tokenText = await tokenResponse.text();
    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch {
      console.log(`[PURCHASER] Invalid token response for ${email}`);
      return null;
    }
    if (!tokenData || !Array.isArray(tokenData) || !tokenData[0]?.token) {
      console.log(`[PURCHASER] No token in response for ${email}`);
      return null;
    }

    console.log(`[PURCHASER] WLID login SUCCESS for ${email}`);
    return {
      method: "wlid",
      token: tokenData[0].token,
      cookieJar,
      headers: DEFAULT_HEADERS,
      email,
    };
  } catch (err) {
    const cause = err?.cause?.message ? ` | cause: ${err.cause.message}` : "";
    console.error(`[PURCHASER] WLID login EXCEPTION for ${email}: ${err.message}${cause}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FLOW 2: Xbox Live OAuth -> XBL3.0 (fallback)
// ═══════════════════════════════════════════════════════════════

const SFTTAG_URL =
  "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

async function loginXboxLive(email, password) {
  const cookieJar = [];

  try {
    console.log(`[PURCHASER] XBL3.0 fallback login for ${email}`);

    const { text: formText } = await sessionFetch(SFTTAG_URL, {
      headers: { "User-Agent": UA },
    }, cookieJar);

    let sFTTag = "";
    let urlPost = "";

    const ppftMatch = formText.match(/"sFTTag":"[^"]*value=\\"([^"\\]+)\\"/);
    if (ppftMatch) sFTTag = ppftMatch[1];
    if (!sFTTag) {
      const m = formText.match(/name="PPFT"[^>]*value="([^"]+)"/);
      if (m) sFTTag = m[1];
    }
    if (!sFTTag) {
      try { sFTTag = formText.split('name="PPFT" id="i0327" value="')[1].split('"')[0]; } catch {}
    }

    const urlMatch = formText.match(/"urlPost":"([^"]+)"/);
    if (urlMatch) urlPost = urlMatch[1];
    if (!urlPost) {
      try { urlPost = formText.split("urlPost:'")[1].split("'")[0]; } catch {}
    }

    if (!sFTTag || !urlPost) {
      console.log(`[PURCHASER] XBL: Failed to extract PPFT/urlPost for ${email}`);
      return null;
    }

    const { text: loginText, finalUrl } = await sessionFetch(urlPost, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        login: email,
        loginfmt: email,
        passwd: password,
        PPFT: sFTTag,
      }).toString(),
    }, cookieJar);

    let accessToken = "";

    if (finalUrl.includes("access_token=")) {
      accessToken = finalUrl.split("access_token=")[1].split("&")[0];
    }
    if (!accessToken && finalUrl.includes("#")) {
      try {
        const hash = new URL(finalUrl).hash.substring(1);
        const params = new URLSearchParams(hash);
        accessToken = params.get("access_token") || "";
      } catch {}
    }

    if (!accessToken) {
      console.log(`[PURCHASER] XBL: Login failed for ${email} (bad creds or MFA)`);
      return null;
    }

    // XBL User Token
    const xblRes = await proxiedFetch("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-xbl-contract-version": "1" },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: accessToken,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    });

    if (xblRes.status !== 200) {
      console.log(`[PURCHASER] XBL: User token failed (${xblRes.status}) for ${email}`);
      return null;
    }

    const xblData = await xblRes.json();
    const xboxToken = xblData.Token;
    const uhs = xblData.DisplayClaims?.xui?.[0]?.uhs;

    if (!xboxToken || !uhs) {
      console.log(`[PURCHASER] XBL: Missing token/uhs for ${email}`);
      return null;
    }

    // XSTS Token
    const xstsRes = await proxiedFetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-xbl-contract-version": "1" },
      body: JSON.stringify({
        Properties: {
          SandboxId: "RETAIL",
          UserTokens: [xboxToken],
        },
        RelyingParty: "http://xboxlive.com",
        TokenType: "JWT",
      }),
    });

    if (xstsRes.status === 401) {
      console.log(`[PURCHASER] XBL: No Xbox account for ${email}`);
      return null;
    }
    if (xstsRes.status !== 200) {
      console.log(`[PURCHASER] XBL: XSTS failed (${xstsRes.status}) for ${email}`);
      return null;
    }

    const xstsData = await xstsRes.json();
    const xstsToken = xstsData.Token;
    const xstsUhs = xstsData.DisplayClaims?.xui?.[0]?.uhs || uhs;

    if (!xstsToken) {
      console.log(`[PURCHASER] XBL: XSTS token missing for ${email}`);
      return null;
    }

    console.log(`[PURCHASER] XBL3.0 login SUCCESS for ${email}`);
    return {
      method: "xbl",
      xblAuth: `XBL3.0 x=${xstsUhs};${xstsToken}`,
      uhs: xstsUhs,
      email,
    };
  } catch (err) {
    console.error(`[PURCHASER] XBL login EXCEPTION for ${email}: ${err.message}`);
    return null;
  }
}

// ── Session validation ──────────────────────────────────────

async function validateSession(session) {
  if (!session) return false;
  if (session.method === "wlid") {
    if (!session.token || !session.cookieJar) return false;
    // Quick check: try token endpoint
    try {
      const cookieStr = getCookieString(session.cookieJar);
      const res = await proxiedFetch(
        "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
        {
          headers: {
            ...TOKEN_HEADERS,
            "User-Agent": UA,
            Referer: "https://account.microsoft.com/billing/redeem",
            Cookie: cookieStr,
          },
        }
      );
      if (res.status === 200) {
        const data = await res.json();
        if (data && Array.isArray(data) && data[0]?.token) {
          // Refresh token
          session.token = data[0].token;
          return true;
        }
      }
      try { await res.text(); } catch {}
      return false;
    } catch {
      return false;
    }
  }
  if (session.method === "xbl") {
    return !!session.xblAuth;
  }
  return false;
}

// ── Product Search & Details ─────────────────────────────────

async function searchProducts(query, market = "US", language = "en-US") {
  try {
    // Primary: autosuggest API
    const res = await proxiedFetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=${market}&languages=${language}&query=${encodeURIComponent(query)}&mediaType=games,apps`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }
    );

    if (res.status === 200) {
      const data = await res.json();
      const results = [];
      for (const family of data.ResultSets || []) {
        for (const suggest of family.Suggests || []) {
          const pid = suggest.ProductId || suggest.Metas?.find(m => m.Key === "BigCatId")?.Value || "";
          if (pid) {
            results.push({
              title: suggest.Title || "Unknown",
              productId: pid,
              type: suggest.Type || family.Type || "",
              imageUrl: suggest.ImageUrl || "",
            });
          }
        }
      }
      if (results.length > 0) return results;
    }

    // Fallback: search API
    const searchRes = await proxiedFetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/products/search?market=${market}&languages=${language}&query=${encodeURIComponent(query)}&mediaType=games,apps&count=10`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }
    );

    if (searchRes.status === 200) {
      const searchData = await searchRes.json();
      const results = [];
      for (const product of searchData.Products || []) {
        const title = product.LocalizedProperties?.[0]?.ProductTitle || "Unknown";
        const productId = product.ProductId;
        if (productId) {
          results.push({ title, productId, type: product.ProductType || "Unknown" });
        }
      }
      return results;
    }

    return [];
  } catch (err) {
    console.error(`[PURCHASER] Search error: ${err.message}`);
    return [];
  }
}

async function getProductDetails(productId, market = "US", language = "en-US") {
  try {
    const res = await proxiedFetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=${market}&languages=${language}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }
    );

    if (res.status !== 200) return null;
    const data = await res.json();

    if (!data.Products || data.Products.length === 0) return null;
    const product = data.Products[0];

    const title = product.LocalizedProperties?.[0]?.ProductTitle || "Unknown";
    const description = product.LocalizedProperties?.[0]?.ShortDescription || "";

    const skus = [];
    for (const dsa of product.DisplaySkuAvailabilities || []) {
      const sku = dsa.Sku;
      const skuTitle = sku?.LocalizedProperties?.[0]?.SkuTitle || title;
      const skuId = sku?.SkuId;

      for (const avail of dsa.Availabilities || []) {
        const price = avail.OrderManagementData?.Price;
        if (price) {
          skus.push({
            skuId,
            availabilityId: avail.AvailabilityId,
            title: skuTitle,
            price: price.ListPrice,
            currency: price.CurrencyCode,
            msrp: price.MSRP,
          });
        }
      }
    }

    return { productId, title, description, skus };
  } catch (err) {
    console.error(`[PURCHASER] Product details error: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  WLID Purchase Flow (Store Checkout) -- with retry
// ═══════════════════════════════════════════════════════════════

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

async function getStoreCartState(session) {
  try {
    const msCv = "xddT7qMNbECeJpTq.6.2";
    const cookieStr = Array.isArray(session.cookieJar)
      ? getCookieString(session.cookieJar)
      : session.cookieJar || "";

    const payload = new URLSearchParams({
      data: '{"usePurchaseSdk":true}',
      market: "US",
      cV: msCv,
      locale: "en-GB",
      msaTicket: session.token,
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
          ...session.headers,
          Cookie: cookieStr,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload.toString(),
      }
    );

    const text = await res.text();
    const match = text.match(/window\.__STORE_CART_STATE__=({.*?});/s);
    if (!match) {
      console.log(`[PURCHASER] No __STORE_CART_STATE__ found`);
      return null;
    }

    const storeState = JSON.parse(match[1]);
    return {
      ms_cv: storeState.appContext?.cv || msCv,
      correlation_id: storeState.appContext?.correlationId || "",
      tracking_id: storeState.appContext?.trackingId || "",
      vector_id: storeState.appContext?.muid || "",
      muid: storeState.appContext?.alternativeMuid || "",
    };
  } catch (err) {
    console.error(`[PURCHASER] getStoreCartState error: ${err.message}`);
    return null;
  }
}

// Select best payment instrument: balance > storedValue > valid card
function selectPaymentInstrument(paymentInstruments) {
  if (!paymentInstruments || paymentInstruments.length === 0) return null;

  // Priority 1: account balance
  const balance = paymentInstruments.find(pi =>
    pi.type === "balance" || pi.paymentMethodFamily === "balance"
  );
  if (balance) return balance;

  // Priority 2: stored value
  const storedValue = paymentInstruments.find(pi =>
    pi.type === "storedValue" || pi.paymentMethodFamily === "storedValue"
  );
  if (storedValue) return storedValue;

  // Priority 3: first valid payment method (skip expired/invalid)
  const validMethods = paymentInstruments.filter(pi => {
    if (pi.isExpired === true) return false;
    if (pi.isInvalid === true) return false;
    if (pi.isDisabled === true) return false;
    return true;
  });

  return validMethods.length > 0 ? validMethods[0] : paymentInstruments[0];
}

async function purchaseViaWlid(session, productId, skuId, availabilityId, storeState) {
  const cookieStr = Array.isArray(session.cookieJar)
    ? getCookieString(session.cookieJar)
    : session.cookieJar || "";

  const basePurchaseHeaders = {
    host: "buynow.production.store-web.dynamics.com",
    connection: "keep-alive",
    "x-ms-tracking-id": storeState.tracking_id,
    authorization: `WLID1.0=t=${session.token}`,
    "x-ms-client-type": "MicrosoftCom",
    "x-ms-market": "US",
    "ms-cv": storeState.ms_cv,
    "x-ms-vector-id": storeState.vector_id,
    "user-agent": UA,
    "x-ms-correlation-id": storeState.correlation_id,
    "content-type": "application/json",
    "x-authorization-muid": storeState.muid,
    accept: "*/*",
    Cookie: cookieStr,
  };

  // Step 1: Add to cart (with retry)
  console.log(`[PURCHASER] Adding to cart: ${productId} / ${skuId}`);
  let addData;
  try {
    addData = await withRetry(async (attempt) => {
      const headers = { ...basePurchaseHeaders, "x-ms-reference-id": generateReferenceId() };
      const res = await proxiedFetch(
        "https://buynow.production.store-web.dynamics.com/v1.0/Cart/AddToCart",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ productId, skuId, availabilityId, quantity: 1 }),
        }
      );

      if (res.status === 429) throw new Error("RATE_LIMITED");
      let data;
      try { data = await res.json(); } catch {
        throw new Error(`AddToCart HTTP ${res.status}`);
      }

      const cartErr = data.events?.cart?.[0];
      if (cartErr?.type === "error") {
        const reason = cartErr.data?.reason || "Cart error";
        if (reason === "AlreadyOwned") return { __terminal: true, success: false, error: "ALREADY_OWNED" };
        if (reason === "NotAvailableInMarket") return { __terminal: true, success: false, error: "REGION_RESTRICTED" };
        if (attempt >= 3) return { __terminal: true, success: false, error: reason };
        throw new Error(reason);
      }
      return data;
    }, 3);
  } catch (err) {
    return { success: false, error: err.message === "RATE_LIMITED" ? "RATE_LIMITED" : `AddToCart: ${err.message}` };
  }
  if (addData?.__terminal) return addData;

  // Step 2: Prepare purchase (with retry)
  console.log(`[PURCHASER] Preparing purchase for ${session.email}`);
  let prepareData;
  try {
    prepareData = await withRetry(async (attempt) => {
      const headers = { ...basePurchaseHeaders, "x-ms-reference-id": generateReferenceId() };
      const res = await proxiedFetch(
        "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/PreparePurchase",
        {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        }
      );

      if (res.status === 429) throw new Error("RATE_LIMITED");
      let data;
      try { data = await res.json(); } catch {
        throw new Error(`PreparePurchase HTTP ${res.status}`);
      }

      const prepErr = data.events?.cart?.[0];
      if (prepErr?.type === "error") {
        const reason = prepErr.data?.reason || "Prepare error";
        if (attempt >= 3) return { __terminal: true, success: false, error: reason };
        throw new Error(reason);
      }
      return data;
    }, 3);
  } catch (err) {
    return { success: false, error: err.message === "RATE_LIMITED" ? "RATE_LIMITED" : `Prepare: ${err.message}` };
  }
  if (prepareData?.__terminal) return prepareData;

  const paymentInstruments = prepareData.paymentInstruments || [];
  const total = prepareData.legalTextInfo?.orderTotal || prepareData.orderTotal || "N/A";

  // Step 3: Select best payment method
  const selectedPI = selectPaymentInstrument(paymentInstruments);
  if (!selectedPI) {
    return { success: false, error: "INSUFFICIENT_BALANCE" };
  }

  console.log(`[PURCHASER] Using payment: ${selectedPI.type || selectedPI.paymentMethodFamily || "unknown"} for ${session.email}`);

  // Step 4: Complete purchase (with retry, careful not to double-buy)
  console.log(`[PURCHASER] Completing purchase for ${session.email}`);
  let completeData;
  try {
    completeData = await withRetry(async (attempt) => {
      const headers = { ...basePurchaseHeaders, "x-ms-reference-id": generateReferenceId() };
      const res = await proxiedFetch(
        "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/CompletePurchase",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ paymentInstrumentId: selectedPI.id }),
        }
      );

      if (res.status === 429) throw new Error("RATE_LIMITED");
      let data;
      try { data = await res.json(); } catch {
        throw new Error(`CompletePurchase HTTP ${res.status}`);
      }

      const compErr = data.events?.cart?.[0];
      if (compErr?.type === "error") {
        const reason = compErr.data?.reason || "Purchase failed";
        if (reason === "InsufficientFunds") return { __terminal: true, success: false, error: "INSUFFICIENT_BALANCE" };
        if (reason === "PaymentDeclined") return { __terminal: true, success: false, error: "PAYMENT_FAILED" };
        if (reason === "AlreadyOwned") return { __terminal: true, success: false, error: "ALREADY_OWNED" };
        // Don't retry purchase errors that could cause double-charge
        return { __terminal: true, success: false, error: reason };
      }

      // Strict success validation: require orderId or explicit purchase event
      if (data.orderId) {
        return { success: true, orderId: data.orderId, total, method: "WLID Store" };
      }
      if (data.events?.purchase) {
        return { success: true, orderId: "Completed", total, method: "WLID Store" };
      }

      // No clear success indicator -- treat as failure
      if (attempt >= 2) {
        return { __terminal: true, success: false, error: "No order confirmation received" };
      }
      throw new Error("Ambiguous response, retrying");
    }, 2); // Only 2 attempts for complete to avoid double purchase
  } catch (err) {
    return { success: false, error: err.message === "RATE_LIMITED" ? "RATE_LIMITED" : `Complete: ${err.message}` };
  }

  return completeData;
}

// ═══════════════════════════════════════════════════════════════
//  XBL3.0 Purchase Flow (Xbox purchase API -- fallback)
// ═══════════════════════════════════════════════════════════════

async function purchaseViaXbl(session, productId, skuId) {
  try {
    console.log(`[PURCHASER] XBL3.0 purchase attempt for ${session.email}`);

    const result = await withRetry(async (attempt) => {
      const purchaseRes = await proxiedFetch(
        "https://purchase.xboxlive.com/v7.0/purchases",
        {
          method: "POST",
          headers: {
            Authorization: session.xblAuth,
            "Content-Type": "application/json",
            "x-xbl-contract-version": "1",
            "User-Agent": UA,
          },
          body: JSON.stringify({
            purchaseRequest: {
              productId,
              skuId,
              quantity: 1,
            },
          }),
        }
      );

      const status = purchaseRes.status;

      if (status >= 200 && status < 300) {
        let resData = {};
        try { resData = await purchaseRes.json(); } catch {}
        if (resData.orderId) {
          return { success: true, orderId: resData.orderId, total: "N/A", method: "XBL3.0" };
        }
        return { success: true, orderId: "XBL-Completed", total: "N/A", method: "XBL3.0" };
      }

      let errData = {};
      try { errData = await purchaseRes.json(); } catch {}

      const code = errData.code || "";
      const desc = errData.description || errData.message || "";

      if (code === "AlreadyOwned" || desc.includes("already own")) {
        return { __terminal: true, success: false, error: "ALREADY_OWNED", method: "XBL3.0" };
      }
      if (code === "InsufficientFunds") {
        return { __terminal: true, success: false, error: "INSUFFICIENT_BALANCE", method: "XBL3.0" };
      }

      if (status === 429 || code === "TooManyRequests") {
        throw new Error("RATE_LIMITED");
      }

      if (attempt >= 2) {
        return { __terminal: true, success: false, error: `${code || status} - ${desc}`.trim(), method: "XBL3.0" };
      }
      throw new Error(`HTTP ${status}`);
    }, 2);

    if (result.__terminal) {
      delete result.__terminal;
      console.log(`[PURCHASER] XBL3.0 purchase FAILED for ${session.email}: ${result.error}`);
    } else if (result.success) {
      console.log(`[PURCHASER] XBL3.0 purchase SUCCESS for ${session.email}`);
    }
    return result;
  } catch (err) {
    return { success: false, error: err.message, method: "XBL3.0" };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Main Purchase Pipeline
//  Accepts optional externalSession to reuse an existing login.
//  Falls back to its own login if session is invalid/expired.
// ═══════════════════════════════════════════════════════════════

async function purchaseItems(accounts, productId, skuId, availabilityId, onProgress, signal, externalSession) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const results = [];

  for (let i = 0; i < parsed.length; i++) {
    if (signal && signal.aborted) break;

    const { email, password } = parsed[i];

    if (onProgress) onProgress("login", { email, done: i, total: parsed.length });

    // Try to reuse external session if provided and matches this email
    let session = null;
    let purchaseResult = null;

    if (externalSession && externalSession.email === email) {
      const valid = await validateSession(externalSession);
      if (valid) {
        session = externalSession;
        console.log(`[PURCHASER] Reusing external session for ${email}`);
      } else {
        console.log(`[PURCHASER] External session expired for ${email}, re-logging in`);
      }
    }

    // Login if no valid session
    if (!session) {
      try {
        session = await loginToStore(email, password);
      } catch (err) {
        console.error(`[PURCHASER] Login error for ${email}: ${err.message}`);
      }
    }

    if (session) {
      if (onProgress) onProgress("cart", { email, done: i, total: parsed.length });

      const storeState = await getStoreCartState(session);
      if (storeState) {
        if (onProgress) onProgress("purchase", { email, done: i, total: parsed.length });
        purchaseResult = await purchaseViaWlid(session, productId, skuId, availabilityId, storeState);
      } else {
        console.log(`[PURCHASER] WLID store state failed for ${email}, trying XBL3.0 fallback...`);
      }
    } else {
      console.log(`[PURCHASER] WLID login failed for ${email}, trying XBL3.0 fallback...`);
    }

    // Fallback to XBL3.0 only if WLID did not succeed
    if (!purchaseResult || !purchaseResult.success) {
      // Don't override terminal errors like ALREADY_OWNED
      const wlidError = purchaseResult?.error || "SESSION_INVALID";

      let xblSession = null;
      try {
        xblSession = await loginXboxLive(email, password);
      } catch (err) {
        console.error(`[PURCHASER] XBL login error for ${email}: ${err.message}`);
      }

      if (xblSession) {
        if (onProgress) onProgress("purchase", { email, done: i, total: parsed.length, method: "XBL3.0" });
        purchaseResult = await purchaseViaXbl(xblSession, productId, skuId);

        if (!purchaseResult.success) {
          purchaseResult.error = `WLID: ${wlidError} | XBL: ${purchaseResult.error}`;
        }
      } else {
        purchaseResult = { success: false, error: `WLID: ${wlidError} | XBL: LOGIN_FAILED` };
      }
    }

    results.push({ email, ...purchaseResult });

    if (onProgress) onProgress("result", { email, ...purchaseResult, done: i + 1, total: parsed.length });

    // Small delay between accounts
    if (i < parsed.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

module.exports = {
  loginToStore,
  loginXboxLive,
  validateSession,
  searchProducts,
  getProductDetails,
  purchaseItems,
  getStoreCartState,
  purchaseViaWlid,
  purchaseViaXbl,
  selectPaymentInstrument,
};
