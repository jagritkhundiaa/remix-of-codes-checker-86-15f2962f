// ============================================================
//  Microsoft Account Password Changer
//  Logs into accounts and changes the password
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

// ── Cookie-aware fetch ───────────────────────────────────────

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

// ── Password Change Flow ─────────────────────────────────────

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function changePassword(email, oldPassword, newPassword) {
  const cookieJar = [];
  const headers = { ...DEFAULT_HEADERS };
  const debug = (step, msg) => console.log(`[CHANGER][${email}] Step ${step}: ${msg}`);

  try {
    // Step 1: Go to password change page - this will redirect to login.live.com
    debug(1, "Navigating to account.live.com/password/Change");
    const { text: page1, finalUrl: url1 } = await sessionFetch(
      "https://account.live.com/password/Change",
      { headers },
      cookieJar
    );
    debug(1, `Landed on: ${url1}`);
    debug(1, `Page length: ${page1.length}, has sFT: ${page1.includes("sFT")}, has urlPost: ${page1.includes("urlPost")}, has PPFT: ${page1.includes("PPFT")}`);

    // Try multiple extraction patterns
    const ppftPatterns = [
      /sFT:'([^']+)'/s,
      /"sFT":"([^"]+)"/s,
      /name="PPFT"[^>]*value="([^"]+)"/s,
      /value="([^"]+)"[^>]*name="PPFT"/s,
    ];
    const urlPostPatterns = [
      /"urlPost":"([^"]+)"/s,
      /urlPost:'([^']+)'/s,
    ];

    let ppft = null;
    let urlPost = null;
    let currentPage = page1;

    for (const p of ppftPatterns) {
      const m = currentPage.match(p);
      if (m) { ppft = m[1]; break; }
    }
    for (const p of urlPostPatterns) {
      const m = currentPage.match(p);
      if (m) { urlPost = m[1]; break; }
    }

    // Fallback: try login.live.com directly
    if (!ppft || !urlPost) {
      debug(2, "Login fields not found on page1, trying login.live.com with wreply");
      const { text: page2, finalUrl: url2 } = await sessionFetch(
        "https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=180&wreply=https%3A%2F%2Faccount.live.com%2Fpassword%2FChange",
        { headers },
        cookieJar
      );
      debug(2, `Landed on: ${url2}`);
      debug(2, `Page length: ${page2.length}, has sFT: ${page2.includes("sFT")}, has urlPost: ${page2.includes("urlPost")}, has PPFT: ${page2.includes("PPFT")}`);
      currentPage = page2;

      for (const p of ppftPatterns) {
        const m = currentPage.match(p);
        if (m) { ppft = m[1]; break; }
      }
      for (const p of urlPostPatterns) {
        const m = currentPage.match(p);
        if (m) { urlPost = m[1]; break; }
      }
    }

    // Last resort: generic value= pattern
    if (!ppft || !urlPost) {
      debug(2, "Still no fields, trying generic value= pattern");
      const valMatch = currentPage.match(/value=\\?"(.+?)\\?"/s) || currentPage.match(/value="(.+?)"/s);
      if (valMatch) ppft = valMatch[1];
      const upMatch = currentPage.match(/"urlPost":"(.+?)"/s) || currentPage.match(/urlPost:'(.+?)'/s);
      if (upMatch) urlPost = upMatch[1];
    }

    if (!ppft || !urlPost) {
      debug("FAIL", `ppft found: ${!!ppft}, urlPost found: ${!!urlPost}`);
      debug("FAIL", `First 500 chars of page: ${currentPage.substring(0, 500)}`);
      return { email, success: false, error: "Could not extract login form" };
    }

    debug(3, `Login fields extracted. ppft length: ${ppft.length}, urlPost: ${urlPost.substring(0, 80)}...`);

    // Step 2: Submit login credentials
    const loginBody = new URLSearchParams({
      login: email,
      loginfmt: email,
      passwd: oldPassword,
      PPFT: ppft,
    });

    const { text: afterLogin, finalUrl: afterLoginUrl } = await sessionFetch(urlPost, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: loginBody.toString(),
    }, cookieJar);

    debug(4, `After login URL: ${afterLoginUrl}`);
    debug(4, `Page length: ${afterLogin.length}, has incorrect: ${afterLogin.includes("incorrect")}, has form: ${afterLogin.includes("<form")}`);

    // Check for login failure
    if (afterLogin.includes("incorrect") || afterLogin.includes("AADSTS50126") || 
        afterLogin.includes("password is incorrect") || afterLogin.includes("Your account or password is incorrect")) {
      return { email, success: false, error: "Invalid credentials" };
    }
    if (afterLogin.includes("account has been locked") || afterLogin.includes("locked")) {
      return { email, success: false, error: "Account locked" };
    }
    if (afterLogin.includes("doesn't exist") || afterLogin.includes("that Microsoft account doesn")) {
      return { email, success: false, error: "Account not found" };
    }

    // Step 3: Handle any intermediate forms (consent, stay signed in, etc.)
    let finalPage = afterLogin;
    const formAction = afterLogin.match(/<form[^>]*action="([^"]+)"/);
    if (formAction) {
      debug(5, `Found intermediate form, submitting to: ${formAction[1].substring(0, 80)}`);
      const inputMatches = [...afterLogin.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
      const formData = new URLSearchParams();
      for (const m of inputMatches) formData.append(m[1], m[2]);
      const { text: nextPage, finalUrl: nextUrl } = await sessionFetch(formAction[1], {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      }, cookieJar);
      debug(5, `After form submission URL: ${nextUrl}`);
      finalPage = nextPage;
    }

    // Step 4: Check if we landed on the password change page
    const hasPwdForm = finalPage.includes("OldPassword") || finalPage.includes("NewPassword") || 
                       finalPage.includes("ChangePassword") || finalPage.includes("apiCanary");
    debug(6, `Has password form: ${hasPwdForm}, page length: ${finalPage.length}`);

    if (!hasPwdForm) {
      debug(6, "Navigating to password change page after login");
      const { text: pwdPage, finalUrl: pwdUrl } = await sessionFetch(
        "https://account.live.com/password/Change",
        { headers },
        cookieJar
      );
      debug(6, `Password page URL: ${pwdUrl}, length: ${pwdPage.length}`);
      debug(6, `Has OldPassword: ${pwdPage.includes("OldPassword")}, has apiCanary: ${pwdPage.includes("apiCanary")}, has sFT: ${pwdPage.includes("sFT")}`);
      finalPage = pwdPage;

      // Might need to re-verify identity
      if (finalPage.includes("urlPost") && finalPage.includes("sFT") && !finalPage.includes("OldPassword")) {
        debug(7, "Re-authentication required");
        let ppft2 = null, urlPost2 = null;
        for (const p of ppftPatterns) { const m = finalPage.match(p); if (m) { ppft2 = m[1]; break; } }
        for (const p of urlPostPatterns) { const m = finalPage.match(p); if (m) { urlPost2 = m[1]; break; } }
        if (ppft2 && urlPost2) {
          const reAuthBody = new URLSearchParams({ login: email, loginfmt: email, passwd: oldPassword, PPFT: ppft2 });
          const { text: reAuthPage, finalUrl: reAuthUrl } = await sessionFetch(urlPost2, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body: reAuthBody.toString(),
          }, cookieJar);
          debug(7, `After re-auth URL: ${reAuthUrl}`);
          finalPage = reAuthPage;
          
          const fa2 = finalPage.match(/<form[^>]*action="([^"]+)"/);
          if (fa2) {
            const im2 = [...finalPage.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
            const fd2 = new URLSearchParams();
            for (const m of im2) fd2.append(m[1], m[2]);
            const { text: np2 } = await sessionFetch(fa2[1], {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
              body: fd2.toString(),
            }, cookieJar);
            finalPage = np2;
          }

          if (!finalPage.includes("OldPassword") && !finalPage.includes("apiCanary")) {
            const { text: pwdPage2, finalUrl: pwdUrl2 } = await sessionFetch(
              "https://account.live.com/password/Change",
              { headers },
              cookieJar
            );
            debug(7, `Final pwd page URL: ${pwdUrl2}, has OldPassword: ${pwdPage2.includes("OldPassword")}`);
            finalPage = pwdPage2;
          }
        }
      }

      if (!finalPage.includes("OldPassword") && !finalPage.includes("apiCanary") && !finalPage.includes("ChangePassword")) {
        debug("FAIL", `First 500 chars of final page: ${finalPage.substring(0, 500)}`);
      }
    }

    return await submitPasswordChange(finalPage, email, oldPassword, newPassword, cookieJar, headers);
  } catch (err) {
    debug("ERROR", err.message);
    return { email, success: false, error: err.message };
  }
}
}

async function submitPasswordChange(pageHtml, email, oldPassword, newPassword, cookieJar, headers) {
  try {
    // Look for the password change form
    // Microsoft uses either an API or form-based approach

    // Try API approach first (modern Microsoft account)
    const canaryMatch = pageHtml.match(/"canary":"([^"]+)"/s) ||
                        pageHtml.match(/canary\s*=\s*'([^']+)'/s) ||
                        pageHtml.match(/name="canary"[^>]*value="([^"]+)"/s);

    const apiCanary = pageHtml.match(/"apiCanary":"([^"]+)"/s);

    if (apiCanary) {
      // Modern API-based password change
      const changeRes = await proxiedFetch(
        "https://account.live.com/password/Change",
        {
          method: "POST",
          headers: {
            ...headers,
            Cookie: getCookieString(cookieJar),
            "Content-Type": "application/x-www-form-urlencoded",
            canary: apiCanary[1],
          },
          body: new URLSearchParams({
            OldPassword: oldPassword,
            NewPassword: newPassword,
            RetypePassword: newPassword,
            ...(canaryMatch ? { canary: canaryMatch[1] } : {}),
          }).toString(),
        }
      );

      extractCookiesFromResponse(changeRes, cookieJar);
      const changeText = await changeRes.text();

      if (changeRes.status === 200 || changeRes.status === 302) {
        if (changeText.includes("PasswordChanged") || changeText.includes("success") ||
            changeText.includes("Your password has been changed") || changeRes.status === 302) {
          return { email, success: true, newPassword };
        }
      }

      // Check for specific errors
      if (changeText.includes("TooShort") || changeText.includes("too short")) {
        return { email, success: false, error: "New password too short" };
      }
      if (changeText.includes("SameAsOld") || changeText.includes("same as your current")) {
        return { email, success: false, error: "New password same as old" };
      }
      if (changeText.includes("PasswordIncorrect") || changeText.includes("incorrect")) {
        return { email, success: false, error: "Current password incorrect" };
      }
    }

    // Try form-based approach
    const formAction = pageHtml.match(/<form[^>]*id="(?:ChangePasswordForm|iForm)"[^>]*action="([^"]+)"/s) ||
                       pageHtml.match(/<form[^>]*action="([^"]*[Pp]assword[^"]*)"[^>]*/s);

    if (formAction) {
      const action = formAction[1].startsWith("http") ? formAction[1] : `https://account.live.com${formAction[1]}`;
      
      const formBody = new URLSearchParams({
        OldPassword: oldPassword,
        NewPassword: newPassword,
        RetypePassword: newPassword,
      });
      if (canaryMatch) formBody.append("canary", canaryMatch[1]);

      // Extract hidden inputs
      const hiddenInputs = [...pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)];
      for (const m of hiddenInputs) {
        if (!formBody.has(m[1])) formBody.append(m[1], m[2]);
      }

      const { res: changeRes, text: changeText } = await sessionFetch(action, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      }, cookieJar);

      if (changeRes.status === 302 || changeText.includes("success") || changeText.includes("PasswordChanged")) {
        return { email, success: true, newPassword };
      }

      if (changeText.includes("incorrect")) {
        return { email, success: false, error: "Current password incorrect" };
      }

      return { email, success: false, error: "Password change did not confirm success" };
    }

    return { email, success: false, error: "Password change form not found" };
  } catch (err) {
    return { email, success: false, error: err.message };
  }
}

// ── Bulk Password Changer ────────────────────────────────────

async function changePasswords(accounts, newPassword, threads = 5, onProgress, signal) {
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

      const { email, password } = parsed[idx];
      const result = await changePassword(email, password, newPassword);
      results.push(result);

      if (onProgress) onProgress(results.length, parsed.length);
    }
  }

  const workerCount = Math.min(threads, parsed.length);
  const workers = Array(workerCount).fill(null).map(() => worker());
  await Promise.all(workers);

  return results;
}

module.exports = { changePassword, changePasswords };
