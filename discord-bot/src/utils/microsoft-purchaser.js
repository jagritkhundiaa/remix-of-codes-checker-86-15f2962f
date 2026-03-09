// ============================================================
//  Microsoft Store Purchaser
//  Two purchase flows:
//    1. Primary: WLID store checkout (buynow.production.store-web.dynamics.com)
//    2. Fallback: Xbox Live OAuth → XBL3.0 → purchase.xboxlive.com
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

// ═══════════════════════════════════════════════════════════════
//  FLOW 1: WLID Store Checkout (primary)
// ═══════════════════════════════════════════════════════════════

async function loginToStore(email, password) {
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
      headers: { ...DEFAULT_HEADERS, Cookie: cookieJar },
      redirect: "follow",
    });
    extractCookies(res);
    return { res, text: await res.text() };
  }

  async function storePost(url, body, extraHeaders = {}) {
    const res = await proxiedFetch(url, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, Cookie: cookieJar, ...extraHeaders },
      body,
      redirect: "follow",
    });
    extractCookies(res);
    return { res, text: await res.text() };
  }

  try {
    console.log(`[PURCHASER] WLID login for ${email}`);
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
    if (!reurlMatch) {
      if (cleaned.includes("sErrTxt") || cleaned.includes("account or password is incorrect")) {
        console.log(`[PURCHASER] Bad credentials for ${email}`);
      } else {
        console.log(`[PURCHASER] No redirect URL found for ${email}`);
      }
      return null;
    }

    const { text: reresp } = await storeGet(reurlMatch[1]);

    const actionMatch = reresp.match(/<form.*?action="(.*?)".*?>/);
    if (!actionMatch) {
      console.log(`[PURCHASER] No form action found for ${email}`);
      return null;
    }

    const inputMatches = [...reresp.matchAll(/<input.*?name="(.*?)".*?value="(.*?)".*?>/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    await storePost(actionMatch[1], formData.toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
    });

    // Acquire store auth token
    await proxiedFetch("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", {
      headers: { ...DEFAULT_HEADERS, Cookie: cookieJar },
    }).catch(() => {});

    const tokenResponse = await proxiedFetch(
      "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
      {
        headers: {
          ...TOKEN_HEADERS,
          "User-Agent": UA,
          Referer: "https://account.microsoft.com/billing/redeem",
          Cookie: cookieJar,
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
//  FLOW 2: Xbox Live OAuth → XBL3.0 (fallback from mody.py)
// ═══════════════════════════════════════════════════════════════

const SFTTAG_URL =
  "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

async function loginXboxLive(email, password) {
  try {
    console.log(`[PURCHASER] XBL3.0 fallback login for ${email}`);

    // Step 1: Get login form
    const formRes = await proxiedFetch(SFTTAG_URL, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    const formText = await formRes.text();

    // Extract PPFT and urlPost dynamically
    let sFTTag = "";
    let urlPost = "";

    const serverDataMatch = formText.match(/var ServerData = ({.*?});/s);
    if (serverDataMatch) {
      try {
        const serverData = JSON.parse(serverDataMatch[1]);
        if (serverData.sFTTag) {
          const ppftMatch = serverData.sFTTag.match(/value="([^"]+)"/);
          if (ppftMatch) sFTTag = ppftMatch[1];
        }
        if (serverData.urlPost) urlPost = serverData.urlPost;
      } catch {}
    }

    if (!sFTTag) {
      const ppftMatch = formText.match(/"sFTTag":"[^"]*value=\\"([^"\\]+)\\"/);
      if (ppftMatch) sFTTag = ppftMatch[1];
    }
    if (!urlPost) {
      const urlMatch = formText.match(/"urlPost":"([^"]+)"/);
      if (urlMatch) urlPost = urlMatch[1];
    }
    if (!sFTTag) {
      try { sFTTag = formText.split('name="PPFT" id="i0327" value="')[1].split('"')[0]; } catch {}
    }
    if (!urlPost) {
      try { urlPost = formText.split("urlPost:'")[1].split("'")[0]; } catch {}
    }

    if (!sFTTag || !urlPost) {
      console.log(`[PURCHASER] XBL: Failed to extract PPFT/urlPost for ${email}`);
      return null;
    }

    // Step 2: Submit credentials
    const loginRes = await proxiedFetch(urlPost, {
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
      redirect: "follow",
    });

    const finalUrl = loginRes.url || "";
    let accessToken = "";

    if (finalUrl.includes("access_token=")) {
      accessToken = finalUrl.split("access_token=")[1].split("&")[0];
    }

    // Check redirect headers if no token in URL
    if (!accessToken && loginRes.headers?.get?.("location")) {
      const loc = loginRes.headers.get("location");
      if (loc.includes("access_token=")) {
        accessToken = loc.split("access_token=")[1].split("&")[0];
      }
    }

    if (!accessToken) {
      console.log(`[PURCHASER] XBL: Login failed for ${email} (bad creds or MFA)`);
      return null;
    }

    // Step 3: XBL User Token
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

    // Step 4: XSTS Token
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

// ── Product Search & Details ─────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════
//  WLID Purchase Flow (Store Checkout)
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
          Cookie: session.cookieJar,
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

async function purchaseViaWlid(session, productId, skuId, availabilityId, storeState) {
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
      Cookie: session.cookieJar,
    };

    // Step 1: Add to cart
    const addToCartRes = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Cart/AddToCart",
      {
        method: "POST",
        headers: purchaseHeaders,
        body: JSON.stringify({ productId, skuId, availabilityId, quantity: 1 }),
      }
    );

    if (addToCartRes.status === 429) return { success: false, error: "Rate limited" };
    const addData = await addToCartRes.json();
    if (addData.events?.cart?.[0]?.type === "error") {
      return { success: false, error: addData.events.cart[0].data?.reason || "Cart error" };
    }

    // Step 2: Prepare purchase
    const prepareRes = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/PreparePurchase",
      {
        method: "POST",
        headers: { ...purchaseHeaders, "x-ms-reference-id": generateReferenceId() },
        body: JSON.stringify({}),
      }
    );

    if (prepareRes.status === 429) return { success: false, error: "Rate limited during prepare" };
    const prepareData = await prepareRes.json();

    const paymentInstruments = prepareData.paymentInstruments || [];
    if (prepareData.events?.cart?.[0]?.type === "error") {
      return { success: false, error: prepareData.events.cart[0].data?.reason || "Prepare error" };
    }

    const total = prepareData.legalTextInfo?.orderTotal || prepareData.orderTotal;

    // Step 3: Complete purchase
    const purchasePayload = {};
    const hasBalance = paymentInstruments.some(pi => pi.type === "storedValue" || pi.type === "balance");

    if (hasBalance) {
      const balanceInstrument = paymentInstruments.find(pi => pi.type === "storedValue" || pi.type === "balance");
      if (balanceInstrument) purchasePayload.paymentInstrumentId = balanceInstrument.id;
    } else if (paymentInstruments.length > 0) {
      purchasePayload.paymentInstrumentId = paymentInstruments[0].id;
    } else {
      return { success: false, error: "No payment method available" };
    }

    const completeRes = await proxiedFetch(
      "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/CompletePurchase",
      {
        method: "POST",
        headers: { ...purchaseHeaders, "x-ms-reference-id": generateReferenceId() },
        body: JSON.stringify(purchasePayload),
      }
    );

    if (completeRes.status === 429) return { success: false, error: "Rate limited during purchase" };
    const completeData = await completeRes.json();

    if (completeData.events?.cart?.[0]?.type === "error") {
      return { success: false, error: completeData.events.cart[0].data?.reason || "Purchase failed" };
    }

    if (completeData.orderId || completeData.events?.purchase) {
      return { success: true, orderId: completeData.orderId || "N/A", total: total || "N/A", method: "WLID Store" };
    }

    return { success: true, orderId: "Completed", total: total || "N/A", method: "WLID Store" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  XBL3.0 Purchase Flow (Xbox purchase API — fallback)
// ═══════════════════════════════════════════════════════════════

async function purchaseViaXbl(session, productId, skuId) {
  try {
    console.log(`[PURCHASER] XBL3.0 purchase attempt for ${session.email}`);

    const purchaseHeaders = {
      Authorization: session.xblAuth,
      "Content-Type": "application/json",
      "x-xbl-contract-version": "1",
      "User-Agent": UA,
    };

    const purchasePayload = {
      purchaseRequest: {
        productId,
        skuId,
        quantity: 1,
      },
    };

    const purchaseRes = await proxiedFetch(
      "https://purchase.xboxlive.com/v7.0/purchases",
      {
        method: "POST",
        headers: purchaseHeaders,
        body: JSON.stringify(purchasePayload),
      }
    );

    const status = purchaseRes.status;

    if (status >= 200 && status < 300) {
      let resData = {};
      try { resData = await purchaseRes.json(); } catch {}
      console.log(`[PURCHASER] XBL3.0 purchase SUCCESS for ${session.email}`);
      return {
        success: true,
        orderId: resData.orderId || "XBL-Completed",
        total: "N/A",
        method: "XBL3.0",
      };
    }

    let errMsg = `HTTP ${status}`;
    try {
      const errData = await purchaseRes.json();
      errMsg = `${errData.code || status} - ${errData.description || errData.message || ""}`.trim();
    } catch {}

    console.log(`[PURCHASER] XBL3.0 purchase FAILED for ${session.email}: ${errMsg}`);
    return { success: false, error: errMsg, method: "XBL3.0" };
  } catch (err) {
    return { success: false, error: err.message, method: "XBL3.0" };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Main Purchase Pipeline — tries WLID first, then XBL3.0
// ═══════════════════════════════════════════════════════════════

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

    // ── Try WLID store login first ──
    let session = await loginToStore(email, password);
    let purchaseResult = null;

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

    // ── Fallback to XBL3.0 if WLID failed ──
    if (!purchaseResult || !purchaseResult.success) {
      const wlidError = purchaseResult?.error || "WLID flow failed";

      const xblSession = await loginXboxLive(email, password);
      if (xblSession) {
        if (onProgress) onProgress("purchase", { email, done: i, total: parsed.length, method: "XBL3.0" });
        purchaseResult = await purchaseViaXbl(xblSession, productId, skuId);

        if (!purchaseResult.success) {
          // Both failed — report both errors
          purchaseResult.error = `WLID: ${wlidError} | XBL: ${purchaseResult.error}`;
        }
      } else {
        purchaseResult = { success: false, error: `WLID: ${wlidError} | XBL: Login failed` };
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
  searchProducts,
  getProductDetails,
  purchaseItems,
  getStoreCartState,
  purchaseViaWlid,
  purchaseViaXbl,
};
