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
      if (status !== 307 && status !== 308) { method = "GET"; body = undefined; }
      try { await res.text(); } catch {}
      continue;
    }

    const text = await res.text();
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
  if (loginPage.includes("OldPassword") || loginPage.includes("apiCanary")) {
    debug("S1", "Already on password change page (no login needed)");
    return { success: true, page: loginPage, alreadyOnPwdPage: true };
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
  if (afterLogin.includes("OldPassword") || afterLogin.includes("apiCanary")) {
    debug("S2", "Landed directly on password change page after login!");
    return { success: true, page: afterLogin, alreadyOnPwdPage: true };
  }

  // Handle consent/intermediate forms
  let currentPage = afterLogin;
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
      const { text: consentPage } = await sessionFetch(actionMatch[0], {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }, cookieJar);
      currentPage = consentPage;
    }
  }

  // Submit any remaining intermediate forms (stay signed in, etc.)
  for (let i = 0; i < 5; i++) {
    // Check if we've reached the password page
    if (currentPage.includes("OldPassword") || currentPage.includes("apiCanary") ||
        currentPage.includes("ChangePassword")) {
      debug("S2", "Reached password change page via intermediate forms");
      return { success: true, page: currentPage, alreadyOnPwdPage: true };
    }

    const formMatch = currentPage.match(/<form[^>]*action="([^"]+)"/);
    if (!formMatch) break;

    const action = formMatch[1];
    const fullAction = action.startsWith("http") ? action : new URL(action, afterLoginUrl).href;
    debug("S2", `Intermediate form ${i + 1}: ${fullAction.substring(0, 60)}`);

    const inputMatches = [...currentPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    const { text: nextPage } = await sessionFetch(fullAction, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    }, cookieJar);

    currentPage = nextPage;
    if (currentPage.length < 100 && currentPage.includes("Too Many")) {
      return { success: false, error: "Rate limited after login", retryable: true };
    }
  }

  return { success: true, page: currentPage };
}

// ── Navigate to password change (if not already there) ───────

async function navigateToPasswordChange(cookieJar, headers, email, debug) {
  debug("S3", "Navigating to password change page");
  await randomDelay(500, 1500);

  const { text: pwdPage, finalUrl: pwdUrl } = await sessionFetch(
    "https://account.live.com/password/Change",
    { headers },
    cookieJar
  );

  debug("S3", `Password page URL: ${pwdUrl.substring(0, 80)}, len: ${pwdPage.length}`);
  debug("S3", `Has OldPassword: ${pwdPage.includes("OldPassword")}, Has apiCanary: ${pwdPage.includes("apiCanary")}`);

  if (pwdPage.length < 100 && (pwdPage.includes("Too Many") || pwdPage.includes("429"))) {
    return { success: false, error: "Rate limited on password page", retryable: true };
  }

  let currentPage = pwdPage;

  // Handle re-auth if the password page requires it
  if (currentPage.includes("urlPost") && currentPage.includes("value=") && !currentPage.includes("OldPassword")) {
    debug("S3", "Re-authentication required on password page");
    const ppftMatch = currentPage.match(/sFT\s*:\s*'([^']+)'/s) ||
                      currentPage.match(/value=\\?"(.+?)\\?"/s) ||
                      currentPage.match(/value="(.+?)"/s);
    const urlPostMatch = currentPage.match(/"urlPost"\s*:\s*"([^"]+)"/s) ||
                         currentPage.match(/urlPost\s*:\s*'([^']+)'/s);

    if (ppftMatch && urlPostMatch) {
      return { success: true, page: currentPage, needsReAuth: true, urlPost: urlPostMatch[1], ppft: ppftMatch[1] };
    }
  }

  // Debug: log what we actually got
  if (!currentPage.includes("OldPassword") && !currentPage.includes("apiCanary")) {
    debug("S3", `Page does NOT contain password form. First 500 chars: ${currentPage.substring(0, 500)}`);
  }

  return { success: true, page: currentPage };
}

// ── Submit password change ───────────────────────────────────

async function submitPasswordChange(pageHtml, email, oldPassword, newPassword, cookieJar, headers) {
  const debug = (msg) => console.log(`[CHANGER][${email}] PWD: ${msg}`);

  if (pageHtml.length < 100) {
    debug(`Page too short (${pageHtml.length})`);
    return { email, success: false, error: "Password page not loaded", retryable: true };
  }

  // Debug: check for various field name patterns
  const hasOldPwd = pageHtml.includes("OldPassword") || pageHtml.includes("iOldPwd") || 
                    pageHtml.includes("oldPassword") || pageHtml.includes("currentPassword") ||
                    pageHtml.includes("proofInput");
  debug(`Page len: ${pageHtml.length}, has password field: ${hasOldPwd}, has apiCanary: ${pageHtml.includes("apiCanary")}`);

  try {
    // Extract canary tokens
    const canaryMatch = pageHtml.match(/"canary"\s*:\s*"([^"]+)"/s) ||
                        pageHtml.match(/canary\s*=\s*'([^']+)'/s) ||
                        pageHtml.match(/name="canary"[^>]*value="([^"]+)"/s);
    const apiCanary = pageHtml.match(/"apiCanary"\s*:\s*"([^"]+)"/s);

    // Extract session ID and other config from the page
    const sessionIdMatch = pageHtml.match(/"sessionId"\s*:\s*"([^"]+)"/s);
    const sctxMatch = pageHtml.match(/"sCtx"\s*:\s*"([^"]+)"/s) ||
                      pageHtml.match(/sCtx\s*=\s*'([^']+)'/s);
    const flowTokenMatch = pageHtml.match(/"sFT"\s*:\s*"([^"]+)"/s) ||
                           pageHtml.match(/sFT\s*:\s*'([^']+)'/s);

    if (apiCanary) {
      debug("Using API method (JSON)");
      
      // Try JSON API first (modern Microsoft account pages)
      const jsonBody = JSON.stringify({
        OldPassword: oldPassword,
        NewPassword: newPassword,
        RetypePassword: newPassword,
        ...(flowTokenMatch ? { FlowToken: flowTokenMatch[1] } : {}),
      });

      const { text: changeText, finalUrl: changeFinalUrl } = await sessionFetch(
        "https://account.live.com/password/Change",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "canary": apiCanary[1],
            "hpgid": "Microsoft_Security_ChangePassword",
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
          return { email, success: false, error: `API error: ${errCode}`, retryable: false };
        }
        if (jsonResponse.success || jsonResponse.State === 1 || jsonResponse.HasSucceeded) {
          return { email, success: true, newPassword, retryable: false };
        }
      }

      // Check HTML response indicators
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

      // If JSON API didn't work, try form-encoded POST with apiCanary
      debug("JSON API didn't confirm, trying form-encoded with apiCanary");
      const { text: formChangeText, finalUrl: formChangeFinalUrl } = await sessionFetch(
        "https://account.live.com/password/Change",
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", canary: apiCanary[1] },
          body: new URLSearchParams({
            OldPassword: oldPassword,
            NewPassword: newPassword,
            RetypePassword: newPassword,
            ...(canaryMatch ? { canary: canaryMatch[1] } : {}),
          }).toString(),
        },
        cookieJar
      );

      debug(`Form result URL: ${formChangeFinalUrl.substring(0, 80)}, len: ${formChangeText.length}`);
      debug(`Form response first 500: ${formChangeText.substring(0, 500)}`);

      if (formChangeText.includes("PasswordChanged") || formChangeText.includes("Your password has been changed") ||
          formChangeText.includes("password has been updated") || formChangeText.includes("successfully changed")) {
        return { email, success: true, newPassword, retryable: false };
      }
      if (formChangeText.includes("PasswordIncorrect") || formChangeText.includes("incorrect"))
        return { email, success: false, error: "Current password incorrect", retryable: false };

      debug(`Neither method confirmed. Form first 300: ${formChangeText.substring(0, 300)}`);
      return { email, success: false, error: "Password change not confirmed", retryable: false };
    }

    // Try form-based approach
    const formAction = pageHtml.match(/<form[^>]*id="(?:ChangePasswordForm|iForm)"[^>]*action="([^"]+)"/s) ||
                       pageHtml.match(/<form[^>]*action="([^"]*[Pp]assword[^"]*)"[^>]*/s);

    if (formAction) {
      debug("Using form method");
      const action = formAction[1].startsWith("http") ? formAction[1] : `https://account.live.com${formAction[1]}`;

      const formBody = new URLSearchParams({ OldPassword: oldPassword, NewPassword: newPassword, RetypePassword: newPassword });
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

  // If login already landed us on the password page, skip navigation
  let pwdPage;
  if (loginResult.alreadyOnPwdPage) {
    debug("S2", "Already on password change page from login flow");
    pwdPage = loginResult.page;
  } else {
    // Phase 2: Navigate to password change page
    const navResult = await navigateToPasswordChange(cookieJar, headers, email, debug);
    if (!navResult.success) {
      return { email, ...navResult };
    }

    pwdPage = navResult.page;

    // Handle re-auth on password page
    if (navResult.needsReAuth) {
      debug("S3", "Re-authenticating for password page");
      const reAuthBody = new URLSearchParams({
        login: email, loginfmt: email, passwd: oldPassword, PPFT: navResult.ppft,
        PPSX: "PassportR", type: "11", LoginOptions: "3",
      });
      const { text: reAuthPage } = await sessionFetch(navResult.urlPost, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: reAuthBody.toString(),
      }, cookieJar);
      pwdPage = reAuthPage;

      // Handle intermediate form after re-auth
      const fa = pwdPage.match(/<form[^>]*action="([^"]+)"/);
      if (fa && !pwdPage.includes("OldPassword")) {
        const im = [...pwdPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
        const fd = new URLSearchParams();
        for (const m of im) fd.append(m[1], m[2]);
        const fullAction = fa[1].startsWith("http") ? fa[1] : new URL(fa[1], navResult.urlPost).href;
        const { text: np } = await sessionFetch(fullAction, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: fd.toString(),
        }, cookieJar);
        pwdPage = np;
      }

      // If still not on password page, try navigating again
      if (!pwdPage.includes("OldPassword") && !pwdPage.includes("apiCanary")) {
        await randomDelay(1000, 2000);
        const { text: p2 } = await sessionFetch("https://account.live.com/password/Change", { headers }, cookieJar);
        pwdPage = p2;
      }
    }
  }

  // Phase 3: Submit password change
  return await submitPasswordChange(pwdPage, email, oldPassword, newPassword, cookieJar, headers);
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

// ── Bulk changer with throttling ─────────────────────────────

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

module.exports = { changePassword, changePasswords };
