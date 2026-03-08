// ============================================================
//  Microsoft Store Purchaser
//  Logs into Microsoft Store, searches for products, and
//  completes purchases using account balance or payment methods.
//  Uses the same hardened login flow as the WLID claimer.
// ============================================================

const crypto = require("crypto");
const { proxiedFetch } = require("./proxy-manager");

// ── Hardened CookieJar (deduplication, proper parsing) ───────

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

// ── Helpers ──────────────────────────────────────────────────

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

// ── Session fetch with redirect handling ─────────────────────

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
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

async function fetchWithCookies(url, options, cookies) {
  let currentUrl = url;
  let maxRedirects = 15;

  while (maxRedirects > 0) {
    const headers = { ...(options.headers || {}), Cookie: cookies.toString() };
    let response;
    try {
      response = await proxiedFetch(currentUrl, { ...options, headers, redirect: "manual" });
    } catch (err) {
      throw new Error(`Request failed at ${currentUrl}: ${err.message}`);
    }
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

// ── Hardened Microsoft Store Login (same as claimer) ─────────

async function loginToStore(email, password) {
  const cookies = new CookieJar();

  try {
    // Step 1: Navigate to billing/redeem (triggers full auth flow)
    console.log(`[PURCHASER] Step 1: Starting auth flow for ${email}`);
    let result = await fetchWithCookies(
      "https://account.microsoft.com/billing/redeem",
      { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://account.microsoft.com/" } },
      cookies
    );
    let text = result.text;

    // Step 2: Extract redirect URL
    const rurlMatch = extractPattern(text, PATTERNS.urlPost);
    if (!rurlMatch) {
      console.log(`[PURCHASER] Could not extract redirect URL for ${email}`);
      return null;
    }
    const rurl = "https://login.microsoftonline.com" + decodeJsonString(rurlMatch);
    result = await fetchWithCookies(rurl, { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://account.microsoft.com/" } }, cookies);
    text = result.text;

    // Step 3: Extract AAD URL and inject username hint
    const furlMatch = extractPattern(text, PATTERNS.urlGoToAad);
    if (!furlMatch) {
      console.log(`[PURCHASER] Could not extract AAD URL for ${email}`);
      return null;
    }
    let furl = decodeJsonString(furlMatch);
    furl = furl.replace("&jshs=0", `&jshs=2&jsh=&jshp=&username=${encodeURIComponent(email)}&login_hint=${encodeURIComponent(email)}`);

    // Step 4: Fetch login page, extract PPFT and urlPost
    console.log(`[PURCHASER] Step 4: Fetching login page for ${email}`);
    result = await fetchWithCookies(furl, { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://login.microsoftonline.com/" } }, cookies);
    text = result.text;

    let sftTag = extractPattern(text, PATTERNS.sftTag);
    if (!sftTag) sftTag = extractPattern(text.replace(/\\/g, ""), PATTERNS.sftTag);
    if (!sftTag) { const m = text.match(/name="PPFT"[^>]+value="([^"]+)"/); if (m) sftTag = m[1]; }
    if (!sftTag) { const m = text.match(/value="([^"]+)"[^>]+name="PPFT"/); if (m) sftTag = m[1]; }
    if (!sftTag) {
      console.log(`[PURCHASER] Could not extract sFT tag for ${email}`);
      return null;
    }

    let urlPost = extractPattern(text, PATTERNS.urlPost);
    if (!urlPost) urlPost = extractPattern(text, PATTERNS.urlPostAlt);
    if (!urlPost) {
      console.log(`[PURCHASER] Could not extract urlPost for ${email}`);
      return null;
    }

    // Step 5: Submit credentials
    console.log(`[PURCHASER] Step 5: Submitting credentials for ${email}`);
    const loginData = new URLSearchParams({ login: email, loginfmt: email, passwd: password, PPFT: sftTag });
    result = await fetchWithCookies(urlPost, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Referer: furl, Origin: "https://login.live.com" },
      body: loginData.toString(),
    }, cookies);
    let loginRequest = result.text.replace(/\\/g, "");

    // Check for bad credentials
    if (loginRequest.includes("Your account or password is incorrect") || loginRequest.includes("sErrTxt")) {
      console.log(`[PURCHASER] Bad credentials for ${email}`);
      return null;
    }

    // Check for 2FA
    if (loginRequest.includes("identity/confirm") || loginRequest.includes("Additional security verification") || loginRequest.includes("Enter code")) {
      console.log(`[PURCHASER] 2FA required for ${email}`);
      return null;
    }

    // Step 6: Handle privacy notice / intermediate pages
    let ppftMatch = extractPattern(loginRequest, PATTERNS.sftToken);
    if (!ppftMatch) {
      const actionUrl = extractPattern(loginRequest, PATTERNS.formAction);
      if (actionUrl && actionUrl.includes("privacynotice")) {
        console.log(`[PURCHASER] Handling privacy notice for ${email}`);
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
    if (!ppftMatch) {
      console.log(`[PURCHASER] Could not extract second sFT token for ${email}`);
      return null;
    }

    // Step 7: Final login POST (stay signed in)
    const lurlMatch = extractPattern(loginRequest, PATTERNS.urlPost);
    if (!lurlMatch) {
      console.log(`[PURCHASER] Could not extract final login URL for ${email}`);
      return null;
    }
    const finalLoginData = new URLSearchParams({ LoginOptions: "1", type: "28", ctx: "", hpgrequestid: "", PPFT: ppftMatch, canary: "" });
    result = await fetchWithCookies(lurlMatch, {
      method: "POST", headers: { ...DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded" }, body: finalLoginData.toString(),
    }, cookies);
    const finishText = result.text;

    // Step 8: Handle replace() redirect
    const reurlMatch = extractPattern(finishText, PATTERNS.replaceUrl);
    let reresp = finishText;
    if (reurlMatch) {
      result = await fetchWithCookies(reurlMatch, { method: "GET", headers: { ...DEFAULT_HEADERS, Referer: "https://login.live.com/" } }, cookies);
      reresp = result.text;
    }

    // Step 9: Handle final redirect form (auto-submit)
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

    // Step 10: Acquire store auth token
    console.log(`[PURCHASER] Step 10: Acquiring store token for ${email}`);
    const tokenResponse = await proxiedFetch("https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL", {
      method: "GET",
      headers: { ...TOKEN_HEADERS, "User-Agent": DEFAULT_HEADERS["User-Agent"], Referer: "https://account.microsoft.com/billing/redeem", Cookie: cookies.toString() },
    });

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

    console.log(`[PURCHASER] Login SUCCESS for ${email}`);
    return {
      token: tokenData[0].token,
      cookies,
      headers: DEFAULT_HEADERS,
      email,
    };
  } catch (err) {
    console.error(`[PURCHASER] Login EXCEPTION for ${email}:`, err.message);
    return null;
  }
}

// ── Product Search ───────────────────────────────────────────

async function searchProducts(query, market = "US", language = "en-US") {
  try {
    const res = await proxiedFetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=${market}&languages=${language}&query=${encodeURIComponent(query)}&mediaType=games,apps`,
      { headers: DEFAULT_HEADERS }
    );

    if (res.status !== 200) return [];
    const data = await res.json();

    const results = [];
    for (const family of data.ResultSets || []) {
      for (const suggest of family.Suggests || []) {
        results.push({
          title: suggest.Title,
          productId: suggest.ProductId || suggest.Metas?.find(m => m.Key === "BigCatId")?.Value,
          type: suggest.Type || family.Type,
          imageUrl: suggest.ImageUrl,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function getProductDetails(productId, market = "US", language = "en-US") {
  try {
    const res = await proxiedFetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=${market}&languages=${language}`,
      { headers: DEFAULT_HEADERS }
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
  } catch {
    return null;
  }
}

// ── Purchase Flow ────────────────────────────────────────────

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
    const msCv = crypto.randomUUID().replace(/-/g, "").substring(0, 16) + ".1";
    const payload = new URLSearchParams({
      data: '{"usePurchaseSdk":true}',
      market: "US",
      cV: msCv,
      locale: "en-US",
      msaTicket: session.token,
      pageFormat: "full",
      urlRef: "https://www.microsoft.com/store",
      clientType: "MicrosoftCom",
      layout: "Inline",
      cssOverride: "StorePurchase",
      scenario: "purchase",
      sdkVersion: "VERSION_PLACEHOLDER",
    });

    const res = await proxiedFetch(
      `https://www.microsoft.com/store/purchase/buynowui/checkout?ms-cv=${msCv}&market=US&locale=en-US&clientName=MicrosoftCom`,
      {
        method: "POST",
        headers: {
          ...session.headers,
          Cookie: session.cookies.toString(),
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
      ms_cv: storeState.appContext?.cv || msCv,
      correlation_id: storeState.appContext?.correlationId || "",
      tracking_id: storeState.appContext?.trackingId || "",
      vector_id: storeState.appContext?.muid || "",
      muid: storeState.appContext?.alternativeMuid || "",
    };
  } catch {
    return null;
  }
}

async function purchaseProduct(session, productId, skuId, availabilityId, storeState) {
  try {
    const referenceId = generateReferenceId();

    const purchaseHeaders = {
      host: "buynow.production.store-web.dynamics.com",
      connection: "keep-alive",
      "x-ms-tracking-id": storeState.tracking_id,
      authorization: `WLID1.0=t=${session.token}`,
      "x-ms-client-type": "MicrosoftCom",
      "x-ms-market": "US",
      "ms-cv": storeState.ms_cv,
      "x-ms-reference-id": referenceId,
      "x-ms-vector-id": storeState.vector_id,
      "user-agent": session.headers["User-Agent"],
      "x-ms-correlation-id": storeState.correlation_id,
      "content-type": "application/json",
      "x-authorization-muid": storeState.muid,
      accept: "*/*",
      Cookie: session.cookies.toString(),
    };

    // Step 1: Add to cart
    const addToCartRes = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Cart/AddToCart",
      {
        method: "POST",
        headers: purchaseHeaders,
        body: JSON.stringify({
          productId,
          skuId,
          availabilityId,
          quantity: 1,
        }),
      }
    );

    if (addToCartRes.status === 429) {
      return { success: false, error: "Rate limited" };
    }

    const addData = await addToCartRes.json();

    if (addData.events?.cart?.[0]?.type === "error") {
      const reason = addData.events.cart[0].data?.reason || "Unknown error";
      return { success: false, error: reason };
    }

    // Step 2: Prepare purchase
    const prepareRes = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/PreparePurchase",
      {
        method: "POST",
        headers: {
          ...purchaseHeaders,
          "x-ms-reference-id": generateReferenceId(),
        },
        body: JSON.stringify({}),
      }
    );

    if (prepareRes.status === 429) {
      return { success: false, error: "Rate limited during prepare" };
    }

    const prepareData = await prepareRes.json();

    const paymentInstruments = prepareData.paymentInstruments || [];
    const hasBalance = paymentInstruments.some(pi => pi.type === "storedValue" || pi.type === "balance");

    if (prepareData.events?.cart?.[0]?.type === "error") {
      const reason = prepareData.events.cart[0].data?.reason || "Unknown error";
      return { success: false, error: reason };
    }

    const total = prepareData.legalTextInfo?.orderTotal || prepareData.orderTotal;

    // Step 3: Complete purchase
    const purchasePayload = {};

    if (hasBalance) {
      const balanceInstrument = paymentInstruments.find(pi => pi.type === "storedValue" || pi.type === "balance");
      if (balanceInstrument) {
        purchasePayload.paymentInstrumentId = balanceInstrument.id;
      }
    } else if (paymentInstruments.length > 0) {
      purchasePayload.paymentInstrumentId = paymentInstruments[0].id;
    } else {
      return { success: false, error: "No payment method available" };
    }

    const completeRes = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/CompletePurchase",
      {
        method: "POST",
        headers: {
          ...purchaseHeaders,
          "x-ms-reference-id": generateReferenceId(),
        },
        body: JSON.stringify(purchasePayload),
      }
    );

    if (completeRes.status === 429) {
      return { success: false, error: "Rate limited during purchase" };
    }

    const completeData = await completeRes.json();

    if (completeData.events?.cart?.[0]?.type === "error") {
      const reason = completeData.events.cart[0].data?.reason || "Purchase failed";
      return { success: false, error: reason };
    }

    if (completeData.orderId || completeData.events?.purchase) {
      return {
        success: true,
        orderId: completeData.orderId || "N/A",
        total: total || "N/A",
      };
    }

    return { success: true, orderId: "Completed", total: total || "N/A" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Main Purchase Pipeline ───────────────────────────────────

async function purchaseItems(accounts, productId, skuId, availabilityId, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const results = [];

  for (let i = 0; i < parsed.length; i++) {
    if (signal && signal.aborted) break;

    const { email, password } = parsed[i];

    if (onProgress) onProgress("login", { email, done: i, total: parsed.length });

    const session = await loginToStore(email, password);
    if (!session) {
      results.push({ email, success: false, error: "Login failed" });
      if (onProgress) onProgress("result", { email, success: false, error: "Login failed", done: i + 1, total: parsed.length });
      continue;
    }

    if (onProgress) onProgress("cart", { email, done: i, total: parsed.length });

    const storeState = await getStoreCartState(session);
    if (!storeState) {
      results.push({ email, success: false, error: "Failed to get store state" });
      if (onProgress) onProgress("result", { email, success: false, error: "Store state failed", done: i + 1, total: parsed.length });
      continue;
    }

    if (onProgress) onProgress("purchase", { email, done: i, total: parsed.length });

    const result = await purchaseProduct(session, productId, skuId, availabilityId, storeState);
    results.push({ email, ...result });

    if (onProgress) onProgress("result", { email, ...result, done: i + 1, total: parsed.length });

    // Small delay between accounts
    if (i < parsed.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

module.exports = {
  loginToStore,
  searchProducts,
  getProductDetails,
  purchaseItems,
  getStoreCartState,
  purchaseProduct,
};
