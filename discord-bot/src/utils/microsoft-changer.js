// ============================================================
//  Microsoft Account Password Changer
//  Logs in and changes password with retry + throttling
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

// ── Regex patterns ───────────────────────────────────────────

const PPFT_PATTERNS = [
  /sFT:'([^']+)'/s,
  /"sFT":"([^"]+)"/s,
  /name="PPFT"[^>]*value="([^"]+)"/s,
  /value="([^"]+)"[^>]*name="PPFT"/s,
];
const URL_POST_PATTERNS = [
  /"urlPost":"([^"]+)"/s,
  /urlPost:'([^']+)'/s,
];

function extractField(page, patterns) {
  for (const p of patterns) {
    const m = page.match(p);
    if (m) return m[1];
  }
  return null;
}

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Single attempt ───────────────────────────────────────────

async function attemptChangePassword(email, oldPassword, newPassword, attempt) {
  const cookieJar = [];
  const headers = { ...DEFAULT_HEADERS };
  const tag = `[CHANGER][${email}][attempt ${attempt}]`;
  const debug = (step, msg) => console.log(`${tag} ${step}: ${msg}`);

  // Step 1: Go straight to login.live.com (avoids account.live.com rate limit on initial page)
  debug("S1", "Loading login page");
  const { text: loginPage, finalUrl: loginUrl } = await sessionFetch(
    "https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=180&wreply=https%3A%2F%2Faccount.live.com%2Fpassword%2FChange",
    { headers },
    cookieJar
  );

  // Check for rate limit on login page itself
  if (loginPage.length < 100 && loginPage.includes("Too Many")) {
    return { email, success: false, error: "Rate limited", retryable: true };
  }

  const ppft = extractField(loginPage, PPFT_PATTERNS);
  const urlPost = extractField(loginPage, URL_POST_PATTERNS);

  if (!ppft || !urlPost) {
    debug("S1", `Failed to extract login fields (page len: ${loginPage.length})`);
    return { email, success: false, error: "Could not extract login form", retryable: false };
  }

  // Step 2: Submit credentials
  debug("S2", "Submitting credentials");
  const loginBody = new URLSearchParams({
    login: email, loginfmt: email, passwd: oldPassword, PPFT: ppft,
  });

  const { text: afterLogin, finalUrl: afterLoginUrl } = await sessionFetch(urlPost, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody.toString(),
  }, cookieJar);

  debug("S2", `After login: ${afterLoginUrl.substring(0, 80)}, len: ${afterLogin.length}`);

  // Check login failures (not retryable)
  if (afterLogin.includes("incorrect") || afterLogin.includes("AADSTS50126") ||
      afterLogin.includes("password is incorrect") || afterLogin.includes("Your account or password is incorrect")) {
    return { email, success: false, error: "Invalid credentials", retryable: false };
  }
  if (afterLogin.includes("account has been locked") || afterLogin.includes("locked")) {
    return { email, success: false, error: "Account locked", retryable: false };
  }
  if (afterLogin.includes("doesn't exist") || afterLogin.includes("that Microsoft account doesn")) {
    return { email, success: false, error: "Account not found", retryable: false };
  }

  // Step 3: Handle intermediate forms (consent, abuse, stay signed in)
  let currentPage = afterLogin;

  // Submit up to 3 intermediate forms
  for (let i = 0; i < 3; i++) {
    const formMatch = currentPage.match(/<form[^>]*action="([^"]+)"/);
    if (!formMatch) break;

    const action = formMatch[1];
    debug("S3", `Intermediate form ${i + 1}: ${action.substring(0, 60)}`);

    const inputMatches = [...currentPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
    const formData = new URLSearchParams();
    for (const m of inputMatches) formData.append(m[1], m[2]);

    const { text: nextPage, finalUrl: nextUrl } = await sessionFetch(action, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    }, cookieJar);

    debug("S3", `Form result: ${nextUrl.substring(0, 60)}, len: ${nextPage.length}`);
    currentPage = nextPage;

    // If we hit rate limit after form, retryable
    if (currentPage.length < 100 && currentPage.includes("Too Many")) {
      return { email, success: false, error: "Rate limited after login", retryable: true };
    }

    // If we already have the password form, stop
    if (currentPage.includes("OldPassword") || currentPage.includes("apiCanary")) break;
  }

  // Step 4: Navigate to password change page if not already there
  if (!currentPage.includes("OldPassword") && !currentPage.includes("apiCanary") && !currentPage.includes("ChangePassword")) {
    debug("S4", "Navigating to password change page");
    
    // Small delay before hitting account.live.com to reduce rate limit chance
    await randomDelay(1000, 3000);

    const { text: pwdPage, finalUrl: pwdUrl } = await sessionFetch(
      "https://account.live.com/password/Change",
      { headers },
      cookieJar
    );

    debug("S4", `Password page: ${pwdUrl.substring(0, 60)}, len: ${pwdPage.length}`);

    if (pwdPage.length < 100 && (pwdPage.includes("Too Many") || pwdPage.includes("429"))) {
      return { email, success: false, error: "Rate limited on password page", retryable: true };
    }

    currentPage = pwdPage;

    // Handle re-auth if needed
    if (currentPage.includes("urlPost") && currentPage.includes("sFT") && !currentPage.includes("OldPassword")) {
      debug("S4", "Re-authentication required");
      const ppft2 = extractField(currentPage, PPFT_PATTERNS);
      const urlPost2 = extractField(currentPage, URL_POST_PATTERNS);
      if (ppft2 && urlPost2) {
        const reAuthBody = new URLSearchParams({ login: email, loginfmt: email, passwd: oldPassword, PPFT: ppft2 });
        const { text: reAuthPage } = await sessionFetch(urlPost2, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: reAuthBody.toString(),
        }, cookieJar);
        currentPage = reAuthPage;

        // Handle one more intermediate form after re-auth
        const fa = currentPage.match(/<form[^>]*action="([^"]+)"/);
        if (fa) {
          const im = [...currentPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
          const fd = new URLSearchParams();
          for (const m of im) fd.append(m[1], m[2]);
          const { text: np } = await sessionFetch(fa[1], {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body: fd.toString(),
          }, cookieJar);
          currentPage = np;
        }

        // If still not on password page, try navigating again
        if (!currentPage.includes("OldPassword") && !currentPage.includes("apiCanary")) {
          await randomDelay(1000, 2000);
          const { text: p2 } = await sessionFetch("https://account.live.com/password/Change", { headers }, cookieJar);
          currentPage = p2;
        }
      }
    }
  }

  // Step 5: Submit password change
  return await submitPasswordChange(currentPage, email, oldPassword, newPassword, cookieJar, headers);
}

// ── Submit password change ───────────────────────────────────

async function submitPasswordChange(pageHtml, email, oldPassword, newPassword, cookieJar, headers) {
  const debug = (msg) => console.log(`[CHANGER][${email}] PWD: ${msg}`);

  if (pageHtml.length < 100) {
    debug(`Page too short (${pageHtml.length}): ${pageHtml}`);
    return { email, success: false, error: "Password page not loaded (likely rate limited)", retryable: true };
  }

  try {
    // Try API approach (modern Microsoft account)
    const canaryMatch = pageHtml.match(/"canary":"([^"]+)"/s) ||
                        pageHtml.match(/canary\s*=\s*'([^']+)'/s) ||
                        pageHtml.match(/name="canary"[^>]*value="([^"]+)"/s);
    const apiCanary = pageHtml.match(/"apiCanary":"([^"]+)"/s);

    if (apiCanary) {
      debug("Using API method");
      const { text: changeText, finalUrl: changeFinalUrl } = await sessionFetch(
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

      debug(`Result URL: ${changeFinalUrl.substring(0, 60)}, len: ${changeText.length}`);

      // Errors (not retryable)
      if (changeText.includes("TooShort") || changeText.includes("too short"))
        return { email, success: false, error: "New password too short", retryable: false };
      if (changeText.includes("SameAsOld") || changeText.includes("same as your current"))
        return { email, success: false, error: "New password same as old", retryable: false };
      if (changeText.includes("PasswordIncorrect") || changeText.includes("incorrect"))
        return { email, success: false, error: "Current password incorrect", retryable: false };
      if (changeText.includes("OldPassword") && changeText.includes("NewPassword"))
        return { email, success: false, error: "Password change failed (form re-displayed)", retryable: false };

      // Rate limit on change submission
      if (changeText.length < 100 && changeText.includes("Too Many"))
        return { email, success: false, error: "Rate limited on change submit", retryable: true };

      // ONLY explicit success
      if (changeText.includes("PasswordChanged") || changeText.includes("Your password has been changed") ||
          changeText.includes("password has been updated") || changeText.includes("You've successfully")) {
        return { email, success: true, newPassword, retryable: false };
      }

      debug(`No confirmation. First 200: ${changeText.substring(0, 200)}`);
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
          changeText.includes("password has been updated") || changeText.includes("You've successfully")) {
        return { email, success: true, newPassword, retryable: false };
      }

      return { email, success: false, error: "Password change not confirmed", retryable: false };
    }

    debug("No password form found on page");
    return { email, success: false, error: "Password change form not found", retryable: true };
  } catch (err) {
    return { email, success: false, error: err.message, retryable: true };
  }
}

// ── Main entry with retry ────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 30000]; // escalating backoff

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

      // Stagger workers: random delay before each account
      await randomDelay(2000, 6000);

      const { email, password } = parsed[idx];
      const result = await changePassword(email, password, newPassword);
      results.push(result);

      if (onProgress) onProgress(results.length, parsed.length);
    }
  }

  // Cap threads lower to reduce rate limiting
  const workerCount = Math.min(threads, parsed.length, 3);
  const workers = Array(workerCount).fill(null).map(() => worker());
  await Promise.all(workers);

  return results;
}

module.exports = { changePassword, changePasswords };
