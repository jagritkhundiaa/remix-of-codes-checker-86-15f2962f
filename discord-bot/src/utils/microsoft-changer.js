// ============================================================
//  Microsoft Account Password Changer
//  Uses direct account.live.com login (NOT Xbox OAuth) to establish
//  proper session cookies for the password change page.
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

// ── Helpers ──────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min, max) => sleep(min + Math.random() * (max - min));

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

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/gi, "/");
}

function extractClientRedirectUrl(html, baseUrl) {
  const patterns = [
    /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url\s*=\s*([^"'>]+)["']/i,
    /location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /(?:window|document|top)\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) continue;

    const raw = decodeHtmlEntities(match[1].trim());
    if (!raw || raw.startsWith("javascript:")) continue;

    try {
      return new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
  }

  return null;
}

function isPasswordChangeContext(pageHtml, finalUrl = "") {
  const onPasswordUrl = /account\.live\.com\/.*password\/change/i.test(finalUrl);
  const hasPasswordMarkers =
    pageHtml.includes("NewPassword") ||
    pageHtml.includes("iNewPwd") ||
    pageHtml.includes("ChangePasswordForm") ||
    pageHtml.includes("API/ChangePassword");

  return onPasswordUrl && hasPasswordMarkers;
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
      if (status !== 307 && status !== 308) {
        method = "GET";
        body = undefined;
      }
      try { await res.text(); } catch {}
      continue;
    }

    const text = await res.text();

    // Some Microsoft pages redirect via meta refresh or JS, not HTTP 3xx
    const clientRedirect = extractClientRedirectUrl(text, currentUrl);
    if (clientRedirect && clientRedirect !== currentUrl) {
      currentUrl = clientRedirect;
      method = "GET";
      body = undefined;
      continue;
    }

    return { res, text, finalUrl: currentUrl };
  }
  throw new Error("Too many redirects");
}

// ── Login via account.live.com (NOT Xbox OAuth) ──────────────

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Use account.live.com directly — this establishes the right session cookies
// for account management pages (password change, security settings, etc.)
const ACCOUNT_LOGIN_URL = "https://account.live.com/password/Change";

async function loginToAccountLive(email, password, cookieJar, headers, debug) {
  // Step 1: Navigate to password change page — it will redirect to login
  debug("S1", "Loading account.live.com/password/Change (will redirect to login)");
  const { text: loginPage, finalUrl: loginUrl } = await sessionFetch(ACCOUNT_LOGIN_URL, { headers }, cookieJar);

  debug("S1", `Redirected to: ${loginUrl.substring(0, 80)}, len: ${loginPage.length}`);

  // If we're already on the password change page (unlikely but handle it)
  if (isPasswordChangeContext(loginPage, loginUrl)) {
    debug("S1", "Already on password change page (no login needed)");
    return { success: true, page: loginPage, finalUrl: loginUrl, alreadyOnPwdPage: true };
  }

  // Extract PPFT
  let match = loginPage.match(/sFT\s*:\s*'([^']+)'/s) ||
              loginPage.match(/sFTTag\s*:.*?value="([^"]+)"/s) ||
              loginPage.match(/value=\\?"(.+?)\\?"/s) ||
              loginPage.match(/name="PPFT"[^>]*value="([^"]+)"/s) ||
              loginPage.match(/value="([^"]+)"[^>]*name="PPFT"/s);
  if (!match) {
    // Try broader match
    match = loginPage.match(/value="(.+?)"/s);
  }
  if (!match) {
    debug("S1", `No PPFT found (page len: ${loginPage.length})`);
    debug("S1", `Page snippet: ${loginPage.substring(0, 300)}`);
    return { success: false, error: "Could not extract login form", retryable: false };
  }
  const ppft = match[1];

  // Extract urlPost
  match = loginPage.match(/"urlPost"\s*:\s*"([^"]+)"/s) ||
          loginPage.match(/urlPost\s*:\s*'([^']+)'/s) ||
          loginPage.match(/urlPost:'([^']+)'/s);
  if (!match) {
    debug("S1", `No urlPost found (page len: ${loginPage.length})`);
    debug("S1", `Page snippet: ${loginPage.substring(0, 300)}`);
    return { success: false, error: "Could not extract urlPost", retryable: false };
  }
  const urlPost = match[1];

  debug("S1", `Extracted login fields OK, urlPost: ${urlPost.substring(0, 60)}`);

  // Step 2: Submit credentials
  debug("S2", "Submitting credentials");
  const loginBody = new URLSearchParams({
    login: email, loginfmt: email, passwd: password, PPFT: ppft,
    PPSX: "PassportR", type: "11", LoginOptions: "3",
    NewUser: "1", i21: "0", CookieDisclosure: "0",
    IsFidoSupported: "0", isSignupPost: "0",
  });

  const { text: afterLogin, finalUrl: afterLoginUrl } = await sessionFetch(urlPost, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody.toString(),
  }, cookieJar);

  debug("S2", `After login URL: ${afterLoginUrl.substring(0, 80)}, len: ${afterLogin.length}`);

  // Check login failures
  if (afterLogin.includes("incorrect") || afterLogin.includes("AADSTS50126") ||
      afterLogin.includes("password is incorrect") || afterLogin.includes("Your account or password is incorrect")) {
    return { success: false, error: "Invalid credentials", retryable: false };
  }
  if (afterLogin.includes("account has been locked") || afterLogin.includes("locked")) {
    return { success: false, error: "Account locked", retryable: false };
  }
  if (afterLogin.includes("doesn't exist") || afterLogin.includes("that Microsoft account doesn")) {
    return { success: false, error: "Account not found", retryable: false };
  }

  // If we landed on the password change page already (ideal case)
  if (isPasswordChangeContext(afterLogin, afterLoginUrl)) {
    debug("S2", "Landed directly on password change page after login!");
    return { success: true, page: afterLogin, finalUrl: afterLoginUrl, alreadyOnPwdPage: true };
  }

  // Handle consent/intermediate forms
  let currentPage = afterLogin;
  let currentUrl = afterLoginUrl;
  if (currentPage.includes("cancel?mkt=")) {
    debug("S2", "Handling consent form");
    const iptMatch = currentPage.match(/(?<="ipt" value=").+?(?=">)/);
    const ppridMatch = currentPage.match(/(?<="pprid" value=").+?(?=">)/);
    const uaidMatch = currentPage.match(/(?<="uaid" value=").+?(?=">)/);
    const actionMatch = currentPage.match(/(?<=id="fmHF" action=").+?(?=" )/);

    if (iptMatch && ppridMatch && uaidMatch && actionMatch) {
      const formBody = new URLSearchParams({
        ipt: iptMatch[0], pprid: ppridMatch[0], uaid: uaidMatch[0],
      });
      const consentResult = await sessionFetch(actionMatch[0], {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }, cookieJar);
      currentPage = consentResult.text;
      currentUrl = consentResult.finalUrl;
    }
  }

  // Submit any remaining intermediate forms (stay signed in, etc.)
  for (let i = 0; i < 5; i++) {
    if (isPasswordChangeContext(currentPage, currentUrl)) {
      debug("S2", "Reached password change page via intermediate forms");
      return { success: true, page: currentPage, finalUrl: currentUrl, alreadyOnPwdPage: true };
    }

    const formMatch = currentPage.match(/<form[^>]*action="([^"]+)"/);
    if (!formMatch) break;

    const action = formMatch[1];
    const fullAction = action.startsWith("http") ? action : new URL(action, currentUrl || afterLoginUrl).href;
    debug("S2", `Intermediate form ${i + 1}: ${fullAction.substring(0, 60)}`);

    const inputMatches = [...currentPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    const nextResult = await sessionFetch(fullAction, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    }, cookieJar);

    currentPage = nextResult.text;
    currentUrl = nextResult.finalUrl;

    if (currentPage.length < 100 && currentPage.includes("Too Many")) {
      return { success: false, error: "Rate limited after login", retryable: true };
    }
  }

  return { success: true, page: currentPage, finalUrl: currentUrl };
}

// ── Navigate to password change (if not already there) ───────

async function navigateToPasswordChange(cookieJar, headers, email, debug) {
  debug("S3", "Navigating to password change page");
  await randomDelay(500, 1500);

  let { text: pwdPage, finalUrl: pwdUrl } = await sessionFetch(
    "https://account.live.com/password/Change",
    { headers },
    cookieJar
  );

  debug("S3", `Password page URL: ${pwdUrl.substring(0, 80)}, len: ${pwdPage.length}`);

  // Handle auto-submit / session establishment forms (fmHF, ar/cancel, etc.)
  for (let i = 0; i < 5; i++) {
    // Check if we've reached the actual password change page
    if (isPasswordChangeContext(pwdPage, pwdUrl)) {
      debug("S3", `Reached password change page after ${i} intermediate forms`);
      break;
    }

    // Check for auto-submit forms (like fmHF with document.fmHF.submit())
    const actionMatch = pwdPage.match(/<form[^>]*action="([^"]+)"[^>]*>/);
    
    if (!actionMatch || actionMatch[1].includes("javascript")) {
      debug("S3", `No submittable form found at step ${i}`);
      break;
    }

    const action = actionMatch[1];
    const fullAction = action.startsWith("http") ? action : new URL(action, pwdUrl).href;
    debug("S3", `Submitting intermediate form ${i + 1}: ${fullAction.substring(0, 80)}`);

    // Extract all hidden inputs
    const inputMatches = [...pwdPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    const result = await sessionFetch(fullAction, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    }, cookieJar);

    pwdPage = result.text;
    pwdUrl = result.finalUrl;
    debug("S3", `After form ${i + 1}: URL=${pwdUrl.substring(0, 80)}, len: ${pwdPage.length}`);
  }

  // After intermediate forms, ALWAYS navigate to password/Change explicitly
  const isOnPwdPage = isPasswordChangeContext(pwdPage, pwdUrl);
  if (!isOnPwdPage) {
    debug("S3", "Not on password/Change URL yet, navigating explicitly...");
    await randomDelay(500, 1500);
    const retryResult = await sessionFetch("https://account.live.com/password/Change", { headers }, cookieJar);
    pwdPage = retryResult.text;
    pwdUrl = retryResult.finalUrl;
    debug("S3", `After explicit nav: URL=${pwdUrl.substring(0, 80)}, len: ${pwdPage.length}`);
    
    // Handle any more intermediate forms on this attempt
    for (let i = 0; i < 3; i++) {
      if (isPasswordChangeContext(pwdPage, pwdUrl)) break;
      const fm = pwdPage.match(/<form[^>]*action="([^"]+)"[^>]*>/);
      if (!fm || fm[1].includes("javascript")) break;
      const action = fm[1].startsWith("http") ? fm[1] : new URL(fm[1], pwdUrl).href;
      debug("S3", `Extra form ${i+1}: ${action.substring(0, 80)}`);
      const im = [...pwdPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
      const fd = new URLSearchParams();
      for (const m of im) fd.append(m[1], m[2]);
      const r = await sessionFetch(action, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: fd.toString() }, cookieJar);
      pwdPage = r.text; pwdUrl = r.finalUrl;
    }
  }

  debug("S3", `Has OldPassword: ${pwdPage.includes("OldPassword")}, Has apiCanary: ${pwdPage.includes("apiCanary")}`);

  if (pwdPage.length < 100 && (pwdPage.includes("Too Many") || pwdPage.includes("429"))) {
    return { success: false, error: "Rate limited on password page", retryable: true };
  }

  let currentPage = pwdPage;

  // Handle re-auth if the password page requires it
  if (currentPage.includes("urlPost") && currentPage.includes("value=") && !isPasswordChangeContext(currentPage, pwdUrl)) {
    debug("S3", "Re-authentication required on password page");
    const ppftMatch = currentPage.match(/sFT\s*:\s*'([^']+)'/s) ||
                      currentPage.match(/value=\\?"(.+?)\\?"/s) ||
                      currentPage.match(/value="(.+?)"/s);
    const urlPostMatch = currentPage.match(/"urlPost"\s*:\s*"([^"]+)"/s) ||
                         currentPage.match(/urlPost\s*:\s*'([^']+)'/s);

    if (ppftMatch && urlPostMatch) {
      return { success: true, page: currentPage, finalUrl: pwdUrl, needsReAuth: true, urlPost: urlPostMatch[1], ppft: ppftMatch[1] };
    }
  }

  if (!isPasswordChangeContext(currentPage, pwdUrl)) {
    debug("S3", `Page does NOT contain password form. URL=${pwdUrl.substring(0, 80)} | First 500 chars: ${currentPage.substring(0, 500)}`);
  }

  return { success: true, page: currentPage, finalUrl: pwdUrl };
}

// ── Submit password change ───────────────────────────────────

async function submitPasswordChange(pageHtml, pageUrl, email, oldPassword, newPassword, cookieJar, headers) {
  const debug = (msg) => console.log(`[CHANGER][${email}] PWD: ${msg}`);

  if (pageHtml.length < 100) {
    debug(`Page too short (${pageHtml.length})`);
    return { email, success: false, error: "Password page not loaded", retryable: true };
  }

  // Strong gate: do not call API unless we're actually on password context
  const hasOldPwd = pageHtml.includes("OldPassword") || pageHtml.includes("iOldPwd") ||
                    pageHtml.includes("oldPassword") || pageHtml.includes("currentPassword") ||
                    pageHtml.includes("proofInput");
  const hasNewPwd = pageHtml.includes("NewPassword") || pageHtml.includes("iNewPwd");
  const isPwdContext = isPasswordChangeContext(pageHtml, pageUrl || "") || hasOldPwd || hasNewPwd;

  debug(`URL: ${(pageUrl || "unknown").substring(0, 100)}, len: ${pageHtml.length}, hasOldPwd: ${hasOldPwd}, hasNewPwd: ${hasNewPwd}, hasApiCanary: ${pageHtml.includes("apiCanary")}`);

  if (!isPwdContext) {
    return { email, success: false, error: "Session expired (not on password page)", retryable: true };
  }

  try {
    // Extract canary tokens
    const canaryMatch = pageHtml.match(/"canary"\s*:\s*"([^"]+)"/s) ||
                        pageHtml.match(/canary\s*=\s*'([^']+)'/s) ||
                        pageHtml.match(/name="canary"[^>]*value="([^"]+)"/s);
    const apiCanary = pageHtml.match(/"apiCanary"\s*:\s*"([^"]+)"/s);

    // Extract session tokens and config from the page
    const sctxMatch = pageHtml.match(/"sCtx"\s*:\s*"([^"]+)"/s) ||
                      pageHtml.match(/sCtx\s*=\s*'([^']+)'/s);
    const flowTokenMatch = pageHtml.match(/"sFT"\s*:\s*"([^"]+)"/s) ||
                           pageHtml.match(/sFT\s*:\s*'([^']+)'/s);

    const hasApiEndpoint = pageHtml.includes("API/ChangePassword") || hasNewPwd || hasOldPwd;

    if (apiCanary && hasApiEndpoint) {
      debug("Using API method (JSON) via /API/ChangePassword");

      // Extract uaid + dynamic ids from page config
      const uaidMatch = pageHtml.match(/"uaid"\s*:\s*"([^"]+)"/s) ||
                        pageHtml.match(/uaid\s*=\s*'([^']+)'/s);
      const hpgidMatch = pageHtml.match(/"hpgid"\s*:\s*(\d+)/s) ||
                         pageHtml.match(/name="hpgid"[^>]*value="(\d+)"/s);
      const scidMatch = pageHtml.match(/"scid"\s*:\s*(\d+)/s) ||
                        pageHtml.match(/name="scid"[^>]*value="(\d+)"/s);

      const hpgid = hpgidMatch ? hpgidMatch[1] : "200710";
      const scid = scidMatch ? Number(scidMatch[1]) : 100104;

      // Build payload matching Microsoft's current API format
      const jsonBody = JSON.stringify({
        ...(canaryMatch ? { canary: canaryMatch[1] } : {}),
        ...(sctxMatch ? { sCtx: sctxMatch[1] } : {}),
        ...(flowTokenMatch ? { token: flowTokenMatch[1] } : { token: null }),
        ...(oldPassword ? { oldPassword } : {}),
        password: newPassword,
        expiryEnabled: false,
        uiflvr: 1001,
        ...(uaidMatch ? { uaid: uaidMatch[1] } : {}),
        scid,
        hpgid: Number(hpgid),
      });

      const { text: changeText, finalUrl: changeFinalUrl } = await sessionFetch(
        "https://account.live.com/API/ChangePassword",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "canary": apiCanary[1],
            "hpgid": hpgid,
            "hpgact": "commit",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: jsonBody,
        },
        cookieJar
      );

      debug(`API result URL: ${changeFinalUrl.substring(0, 80)}, len: ${changeText.length}`);
      debug(`API response first 500: ${changeText.substring(0, 500)}`);

      // Check for JSON response
      let jsonResponse;
      try { jsonResponse = JSON.parse(changeText); } catch {}

      if (jsonResponse) {
        debug(`JSON response keys: ${Object.keys(jsonResponse).join(", ")}`);
        if (jsonResponse.error) {
          const errCode = jsonResponse.error.code || jsonResponse.error;
          debug(`API error: ${JSON.stringify(jsonResponse.error)}`);
          if (String(errCode).includes("PasswordIncorrect") || String(errCode).includes("1003"))
            return { email, success: false, error: "Current password incorrect", retryable: false };
          if (String(errCode).includes("TooShort"))
            return { email, success: false, error: "New password too short", retryable: false };
          if (String(errCode).includes("SameAsOld"))
            return { email, success: false, error: "New password same as old", retryable: false };
          if (String(errCode).includes("Banned") || String(errCode).includes("banned"))
            return { email, success: false, error: "Password is banned/too common", retryable: false };
          return { email, success: false, error: `API error: ${errCode}`, retryable: false };
        }
        if (jsonResponse.success || jsonResponse.State === 1 || jsonResponse.HasSucceeded) {
          return { email, success: true, newPassword, retryable: false };
        }
      }

      // Check HTML/text response indicators
      if (changeText.includes("TooShort") || changeText.includes("too short"))
        return { email, success: false, error: "New password too short", retryable: false };
      if (changeText.includes("SameAsOld") || changeText.includes("same as your current"))
        return { email, success: false, error: "New password same as old", retryable: false };
      if (changeText.includes("PasswordIncorrect") || changeText.includes("incorrect"))
        return { email, success: false, error: "Current password incorrect", retryable: false };
      if (changeText.length < 100 && changeText.includes("Too Many"))
        return { email, success: false, error: "Rate limited on change submit", retryable: true };
      if (changeText.includes("PasswordChanged") || changeText.includes("Your password has been changed") ||
          changeText.includes("password has been updated") || changeText.includes("You've successfully") ||
          changeText.includes("successfully changed")) {
        return { email, success: true, newPassword, retryable: false };
      }

      // Fallback: try legacy form-encoded POST to /password/Change
      debug("API didn't confirm, trying legacy form-encoded fallback");
      const { text: formChangeText } = await sessionFetch(
        "https://account.live.com/password/Change",
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", canary: apiCanary[1] },
          body: new URLSearchParams({
            NewPassword: newPassword,
            RetypePassword: newPassword,
            ...(canaryMatch ? { canary: canaryMatch[1] } : {}),
          }).toString(),
        },
        cookieJar
      );

      if (formChangeText.includes("PasswordChanged") || formChangeText.includes("Your password has been changed") ||
          formChangeText.includes("password has been updated") || formChangeText.includes("successfully changed")) {
        return { email, success: true, newPassword, retryable: false };
      }
      if (formChangeText.includes("PasswordIncorrect") || formChangeText.includes("incorrect"))
        return { email, success: false, error: "Current password incorrect", retryable: false };

      debug(`Neither method confirmed. Response first 300: ${formChangeText.substring(0, 300)}`);
      return { email, success: false, error: "Password change not confirmed", retryable: false };
    }

    // Try form-based approach
    const formAction = pageHtml.match(/<form[^>]*id="(?:ChangePasswordForm|iForm)"[^>]*action="([^"]+)"/s) ||
                       pageHtml.match(/<form[^>]*action="([^"]*[Pp]assword[^"]*)"[^>]*/s);

    if (formAction) {
      debug("Using form method");
      const action = formAction[1].startsWith("http") ? formAction[1] : `https://account.live.com${formAction[1]}`;

      const formBody = new URLSearchParams({ NewPassword: newPassword, RetypePassword: newPassword });
      if (canaryMatch) formBody.append("canary", canaryMatch[1]);

      const hiddenInputs = [...pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
      for (const m of hiddenInputs) {
        if (!formBody.has(m[1])) formBody.append(m[1], m[2]);
      }

      const { text: changeText } = await sessionFetch(action, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }, cookieJar);

      if (changeText.includes("incorrect") || changeText.includes("PasswordIncorrect"))
        return { email, success: false, error: "Current password incorrect", retryable: false };
      if (changeText.includes("OldPassword") && changeText.includes("NewPassword"))
        return { email, success: false, error: "Password change failed (form re-displayed)", retryable: false };

      if (changeText.includes("PasswordChanged") || changeText.includes("Your password has been changed") ||
          changeText.includes("password has been updated") || changeText.includes("You've successfully") ||
          changeText.includes("successfully changed")) {
        return { email, success: true, newPassword, retryable: false };
      }

      return { email, success: false, error: "Password change not confirmed", retryable: false };
    }

    // Check if we got a login page instead
    if (pageHtml.includes("urlPost") || pageHtml.includes("loginfmt") || pageHtml.includes("login.live.com")) {
      debug("Got login page instead of password form - session not established properly");
      return { email, success: false, error: "Session expired (got login page)", retryable: true };
    }

    debug(`No password form found. First 500: ${pageHtml.substring(0, 500)}`);
    return { email, success: false, error: "Password change form not found", retryable: true };
  } catch (err) {
    return { email, success: false, error: err.message, retryable: true };
  }
}

// ── Single attempt ───────────────────────────────────────────

async function attemptChangePassword(email, oldPassword, newPassword, attempt) {
  const cookieJar = [];
  const headers = { ...DEFAULT_HEADERS };
  const tag = `[CHANGER][${email}][attempt ${attempt}]`;
  const debug = (step, msg) => console.log(`${tag} ${step}: ${msg}`);

  // Phase 1: Login via account.live.com (NOT Xbox OAuth)
  // By navigating to the password change URL, it redirects to login,
  // and after login it redirects back — establishing proper cookies.
  const loginResult = await loginToAccountLive(email, oldPassword, cookieJar, headers, debug);
  if (!loginResult.success) {
    return { email, ...loginResult };
  }

  debug("S2", "Login successful");

  // Check if login already landed us on the password page
  let pwdPage;
  let pwdUrl = loginResult.finalUrl || "";

  if (loginResult.alreadyOnPwdPage && isPasswordChangeContext(loginResult.page, loginResult.finalUrl || "")) {
    debug("S2", "Already on password change page from login flow");
    pwdPage = loginResult.page;
  } else {
    // Navigate to password change page explicitly
    const navResult = await navigateToPasswordChange(cookieJar, headers, email, debug);
    if (!navResult.success) {
      return { email, ...navResult };
    }

    pwdPage = navResult.page;
    pwdUrl = navResult.finalUrl || pwdUrl;

    // Handle re-auth on password page
    if (navResult.needsReAuth) {
      debug("S3", "Re-authenticating for password page");
      const reAuthBody = new URLSearchParams({
        login: email, loginfmt: email, passwd: oldPassword, PPFT: navResult.ppft,
        PPSX: "PassportR", type: "11", LoginOptions: "3",
      });
      const reAuthResult = await sessionFetch(navResult.urlPost, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: reAuthBody.toString(),
      }, cookieJar);
      pwdPage = reAuthResult.text;
      pwdUrl = reAuthResult.finalUrl;

      // Handle intermediate form after re-auth
      const fa = pwdPage.match(/<form[^>]*action="([^"]+)"/);
      if (fa && !isPasswordChangeContext(pwdPage, pwdUrl)) {
        const im = [...pwdPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
        const fd = new URLSearchParams();
        for (const m of im) fd.append(m[1], m[2]);
        const fullAction = fa[1].startsWith("http") ? fa[1] : new URL(fa[1], navResult.urlPost).href;
        const nextResult = await sessionFetch(fullAction, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: fd.toString(),
        }, cookieJar);
        pwdPage = nextResult.text;
        pwdUrl = nextResult.finalUrl;
      }

      // If still not on password page, try navigating again
      if (!isPasswordChangeContext(pwdPage, pwdUrl)) {
        await randomDelay(1000, 2000);
        const p2 = await sessionFetch("https://account.live.com/password/Change", { headers }, cookieJar);
        pwdPage = p2.text;
        pwdUrl = p2.finalUrl;
      }
    }
  }

  // Verify we actually have the password change page before submitting
  if (!isPasswordChangeContext(pwdPage, pwdUrl)) {
    debug("S3", `Not on password change page yet (URL=${(pwdUrl || "unknown").substring(0, 80)}), navigating explicitly...`);
    await randomDelay(500, 1500);
    const retry = await sessionFetch("https://account.live.com/password/Change", { headers }, cookieJar);
    pwdPage = retry.text;
    pwdUrl = retry.finalUrl;
  }

  // Phase 3: Submit password change
  return await submitPasswordChange(pwdPage, pwdUrl, email, oldPassword, newPassword, cookieJar, headers);
}

// ── Main entry with retry ────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 30000];

async function changePassword(email, oldPassword, newPassword) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptChangePassword(email, oldPassword, newPassword, attempt);

    if (result.success || !result.retryable || attempt === MAX_RETRIES) {
      delete result.retryable;
      return result;
    }

    const delay = RETRY_DELAYS[attempt - 1] + Math.random() * 5000;
    console.log(`[CHANGER][${email}] Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_RETRIES}: ${result.error})`);
    await sleep(delay);
  }
}

async function checkAccount(email, password) {
  const cookieJar = [];
  const headers = { ...DEFAULT_HEADERS };
  const silentDebug = () => {};

  const loginResult = await loginToAccountLive(email, password, cookieJar, headers, silentDebug);

  if (!loginResult.success) {
    const error = loginResult.error || "Login failed";
    if (error.includes("Invalid credentials")) {
      return { email, success: false, status: "invalid", error: "Invalid credentials" };
    }
    if (error.includes("Account locked")) {
      return { email, success: false, status: "locked", error: "Account locked" };
    }
    if (error.includes("Rate limited")) {
      return { email, success: false, status: "rate_limited", error: "Rate limited" };
    }
    return { email, success: false, status: "error", error };
  }

  return { email, success: true, status: "valid" };
}

// ── Bulk utilities with throttling ────────────────────────────

async function changePasswords(accounts, newPassword, threads = 3, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const results = [];
  let currentIndex = 0;

  async function worker() {
    while (true) {
      if (signal && signal.aborted) break;
      const idx = currentIndex++;
      if (idx >= parsed.length) break;
      await randomDelay(2000, 6000);

      const { email, password } = parsed[idx];
      const result = await changePassword(email, password, newPassword);
      results.push(result);

      if (onProgress) onProgress(results.length, parsed.length);
    }
  }

  const workerCount = Math.min(threads, parsed.length, 3);
  const workers = Array(workerCount).fill(null).map(() => worker());
  await Promise.all(workers);

  return results;
}

async function checkAccounts(accounts, threads = 3, onProgress, signal) {
  const parsed = accounts.map((a) => {
    const i = a.indexOf(":");
    return i === -1 ? { email: a, password: "" } : { email: a.substring(0, i), password: a.substring(i + 1) };
  });

  const results = [];
  let currentIndex = 0;

  async function worker() {
    while (true) {
      if (signal && signal.aborted) break;
      const idx = currentIndex++;
      if (idx >= parsed.length) break;
      await randomDelay(1000, 3000);

      const { email, password } = parsed[idx];
      const result = await checkAccount(email, password);
      results.push(result);

      if (onProgress) onProgress(results.length, parsed.length);
    }
  }

  const workerCount = Math.min(threads, parsed.length, 5);
  const workers = Array(workerCount).fill(null).map(() => worker());
  await Promise.all(workers);

  return results;
}

module.exports = { changePassword, changePasswords, checkAccount, checkAccounts };
