// ============================================================
//  Microsoft Account Recovery (ACSR) via raw HTTP requests
//  Manual CAPTCHA mode — bot sends captcha image to Discord,
//  user replies with solution, bot completes recovery.
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

// ── Cookie-aware session fetch ───────────────────────────────

function extractCookiesFromResponse(res, cookieJar) {
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const parts = c.split(";")[0].trim();
    if (parts.includes("=")) {
      cookieJar.push(parts);
    }
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
      headers: {
        ...options.headers,
        Cookie: getCookieString(cookieJar),
      },
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
    return { res, text, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// ── Common headers ───────────────────────────────────────────

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ── ACSR Flow ────────────────────────────────────────────────

const ACSR_START_URL = "https://account.live.com/acsr";

/**
 * Phase 1: Initiate account recovery — navigate to ACSR, submit email.
 * Returns session state needed for Phase 2 (CAPTCHA solving).
 */
async function initiateRecovery(email) {
  const cookieJar = [];
  const headers = { ...BROWSER_HEADERS };

  try {
    // Step 1: Load the ACSR page
    const { text: acsrPage, finalUrl } = await sessionFetch(ACSR_START_URL, {
      headers,
    }, cookieJar);

    // Extract PPFT token
    let ppft = null;
    const ppftMatch = acsrPage.match(/sFT\s*[:=]\s*'([^']+)'/s) || acsrPage.match(/name="PPFT"[^>]*value="([^"]+)"/s);
    if (ppftMatch) ppft = ppftMatch[1];

    // Extract urlPost
    let urlPost = null;
    const urlPostMatch = acsrPage.match(/urlPost\s*[:=]\s*'([^']+)'/s) || acsrPage.match(/"urlPost"\s*:\s*"([^"]+)"/s);
    if (urlPostMatch) urlPost = urlPostMatch[1];

    // Extract canary / other tokens
    let canary = null;
    const canaryMatch = acsrPage.match(/canary\s*[:=]\s*"([^"]+)"/s) || acsrPage.match(/"canary"\s*:\s*"([^"]+)"/s);
    if (canaryMatch) canary = canaryMatch[1];

    // Extract the form action URL if urlPost not found
    if (!urlPost) {
      const formMatch = acsrPage.match(/<form[^>]*action="([^"]+)"[^>]*>/s);
      if (formMatch) urlPost = formMatch[1];
    }

    if (!urlPost) {
      return { success: false, error: "Could not find ACSR form URL", phase: "init" };
    }

    // Resolve relative URLs to absolute
    if (urlPost && !urlPost.startsWith("http")) {
      urlPost = new URL(urlPost, finalUrl).href;
    }

    // Step 2: Submit the email address
    const formBody = new URLSearchParams();
    formBody.append("login", email);
    formBody.append("loginfmt", email);
    if (ppft) formBody.append("PPFT", ppft);
    if (canary) formBody.append("canary", canary);

    const { text: emailPage, finalUrl: emailFinalUrl } = await sessionFetch(urlPost, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: finalUrl,
      },
      body: formBody.toString(),
    }, cookieJar);

    // Step 3: Check for CAPTCHA / identity verification page
    // Look for FunCaptcha or HIP challenge
    const captchaInfo = extractCaptchaInfo(emailPage, emailFinalUrl);

    if (captchaInfo.hasCaptcha) {
      return {
        success: true,
        phase: "captcha_required",
        email,
        captchaInfo,
        cookieJar,
        headers,
        pageHtml: emailPage,
        pageUrl: emailFinalUrl,
      };
    }

    // Check if we're on the identity verification page (no CAPTCHA needed)
    const verifyInfo = extractVerificationOptions(emailPage);
    if (verifyInfo.hasOptions) {
      return {
        success: true,
        phase: "verify_identity",
        email,
        verifyInfo,
        cookieJar,
        headers,
        pageHtml: emailPage,
        pageUrl: emailFinalUrl,
      };
    }

    // Check for error messages
    const errorMatch = emailPage.match(/id="error[^"]*"[^>]*>([^<]+)</s) ||
                       emailPage.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</s);
    if (errorMatch) {
      return { success: false, error: errorMatch[1].trim(), phase: "init" };
    }

    // If we reached a password reset page directly
    if (emailPage.includes("NewPassword") || emailPage.includes("newPassword") || emailPage.includes("ResetPassword")) {
      return {
        success: true,
        phase: "password_reset",
        email,
        cookieJar,
        headers,
        pageHtml: emailPage,
        pageUrl: emailFinalUrl,
      };
    }

    return {
      success: true,
      phase: "unknown_page",
      email,
      cookieJar,
      headers,
      pageHtml: emailPage.substring(0, 2000),
      pageUrl: emailFinalUrl,
    };
  } catch (err) {
    return { success: false, error: err.message, phase: "init" };
  }
}

/**
 * Extract CAPTCHA challenge info from the page.
 */
function extractCaptchaInfo(html, pageUrl) {
  const result = {
    hasCaptcha: false,
    type: null, // "funcaptcha" | "hip" | "arkose"
    siteKey: null,
    captchaUrl: null,
    imageUrl: null,
    sessionId: null,
    flowToken: null,
  };

  // Check for FunCaptcha / Arkose Labs
  const arkoseMatch = html.match(/public_key\s*[:=]\s*["']([^"']+)["']/s) ||
                      html.match(/data-pkey\s*=\s*["']([^"']+)["']/s) ||
                      html.match(/"siteKey"\s*:\s*"([^"]+)"/s);
  if (arkoseMatch) {
    result.hasCaptcha = true;
    result.type = "funcaptcha";
    result.siteKey = arkoseMatch[1];
  }

  // Check for HIP image captcha
  const hipMatch = html.match(/hipUrl\s*[:=]\s*["']([^"']+)["']/s) ||
                   html.match(/<img[^>]*id="hipImage"[^>]*src="([^"]+)"/s) ||
                   html.match(/HipImageUrl\s*[:=]\s*["']([^"']+)["']/s);
  if (hipMatch) {
    result.hasCaptcha = true;
    result.type = "hip";
    result.imageUrl = hipMatch[1].startsWith("http") ? hipMatch[1] : new URL(hipMatch[1], pageUrl).href;
  }

  // Check for generic captcha markers
  if (!result.hasCaptcha) {
    if (html.includes("captcha") || html.includes("CAPTCHA") || html.includes("hip_solution") ||
        html.includes("enforcement") || html.includes("funcaptcha")) {
      result.hasCaptcha = true;
      result.type = "unknown";
    }
  }

  // Extract flow token
  const ftMatch = html.match(/sFT\s*[:=]\s*'([^']+)'/s) || html.match(/name="flowtoken"[^>]*value="([^"]+)"/si);
  if (ftMatch) result.flowToken = ftMatch[1];

  // Extract session ID
  const sidMatch = html.match(/sessionId\s*[:=]\s*["']([^"']+)["']/s) || html.match(/name="session"[^>]*value="([^"]+)"/si);
  if (sidMatch) result.sessionId = sidMatch[1];

  return result;
}

/**
 * Extract identity verification options (email/phone choices).
 */
function extractVerificationOptions(html) {
  const result = { hasOptions: false, options: [] };

  // Look for proof options (masked emails, phone numbers)
  const proofMatches = [...html.matchAll(/data-bind="[^"]*ProofConfirmation[^"]*"[^>]*>([^<]+)</g)];
  if (proofMatches.length > 0) {
    result.hasOptions = true;
    result.options = proofMatches.map((m, i) => ({ index: i, label: m[1].trim() }));
  }

  // Alternative: radio buttons with proof options
  const radioMatches = [...html.matchAll(/<input[^>]*name="Proof"[^>]*value="([^"]+)"[^>]*>[^<]*(?:<[^l][^>]*>[^<]*)*<label[^>]*>([^<]+)<\/label>/g)];
  if (radioMatches.length > 0) {
    result.hasOptions = true;
    result.options = radioMatches.map((m, i) => ({ index: i, value: m[1], label: m[2].trim() }));
  }

  return result;
}

/**
 * Phase 2: Submit CAPTCHA solution and continue recovery.
 * @param {object} session - Session state from Phase 1
 * @param {string} captchaSolution - The CAPTCHA solution text
 */
async function submitCaptchaAndContinue(session, captchaSolution) {
  const { cookieJar, headers, pageHtml, pageUrl, captchaInfo } = session;

  try {
    // Build the CAPTCHA submission form
    const formBody = new URLSearchParams();

    if (captchaInfo.type === "hip") {
      // HIP image captcha — submit solution directly
      formBody.append("hip_solution", captchaSolution);
      if (captchaInfo.flowToken) formBody.append("flowtoken", captchaInfo.flowToken);
      if (captchaInfo.sessionId) formBody.append("session", captchaInfo.sessionId);

      // Extract any hidden fields
      const hiddenFields = [...pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi)];
      for (const [, name, value] of hiddenFields) {
        if (!formBody.has(name)) formBody.append(name, value);
      }
    } else if (captchaInfo.type === "funcaptcha") {
      // FunCaptcha — submit the token from the solving service
      formBody.append("fc_token", captchaSolution);
      if (captchaInfo.flowToken) formBody.append("flowtoken", captchaInfo.flowToken);

      const hiddenFields = [...pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi)];
      for (const [, name, value] of hiddenFields) {
        if (!formBody.has(name)) formBody.append(name, value);
      }
    } else {
      // Generic — try submitting as hip_solution
      formBody.append("hip_solution", captchaSolution);
      formBody.append("hip_answer", captchaSolution);
      if (captchaInfo.flowToken) formBody.append("flowtoken", captchaInfo.flowToken);

      const hiddenFields = [...pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi)];
      for (const [, name, value] of hiddenFields) {
        if (!formBody.has(name)) formBody.append(name, value);
      }
    }

    // Find the form action URL
    let actionUrl = pageUrl;
    const formAction = pageHtml.match(/<form[^>]*action="([^"]+)"[^>]*>/s);
    if (formAction) {
      actionUrl = formAction[1].startsWith("http") ? formAction[1] : new URL(formAction[1], pageUrl).href;
    }

    const { text: resultPage, finalUrl } = await sessionFetch(actionUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: pageUrl,
      },
      body: formBody.toString(),
    }, cookieJar);

    // Check if we landed on password reset page
    if (resultPage.includes("NewPassword") || resultPage.includes("newPassword") || resultPage.includes("ResetPassword")) {
      return {
        success: true,
        phase: "password_reset",
        cookieJar,
        headers,
        pageHtml: resultPage,
        pageUrl: finalUrl,
      };
    }

    // Check if there's another CAPTCHA
    const newCaptcha = extractCaptchaInfo(resultPage, finalUrl);
    if (newCaptcha.hasCaptcha) {
      return {
        success: true,
        phase: "captcha_required",
        captchaInfo: newCaptcha,
        cookieJar,
        headers,
        pageHtml: resultPage,
        pageUrl: finalUrl,
      };
    }

    // Check for verification options
    const verifyInfo = extractVerificationOptions(resultPage);
    if (verifyInfo.hasOptions) {
      return {
        success: true,
        phase: "verify_identity",
        verifyInfo,
        cookieJar,
        headers,
        pageHtml: resultPage,
        pageUrl: finalUrl,
      };
    }

    // Check for errors
    const errorMatch = resultPage.match(/id="error[^"]*"[^>]*>([^<]+)</s) ||
                       resultPage.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</s);
    if (errorMatch) {
      return { success: false, error: errorMatch[1].trim(), phase: "captcha_failed" };
    }

    return {
      success: true,
      phase: "unknown_page",
      cookieJar,
      headers,
      pageHtml: resultPage.substring(0, 2000),
      pageUrl: finalUrl,
    };
  } catch (err) {
    return { success: false, error: err.message, phase: "captcha_submit" };
  }
}

/**
 * Phase 3: Submit the new password on the password reset page.
 */
async function submitNewPassword(session, newPassword) {
  const { cookieJar, headers, pageHtml, pageUrl } = session;

  try {
    const formBody = new URLSearchParams();

    // Try JSON API first (modern Microsoft flow)
    const canaryMatch = pageHtml.match(/canary\s*[:=]\s*["']([^"']+)["']/s) ||
                        pageHtml.match(/"canary"\s*:\s*"([^"]+)"/s);
    const sCtxMatch = pageHtml.match(/sCtx\s*[:=]\s*["']([^"']+)["']/s) ||
                      pageHtml.match(/"sCtx"\s*:\s*"([^"]+)"/s);
    const flowTokenMatch = pageHtml.match(/sFT\s*[:=]\s*'([^']+)'/s) ||
                           pageHtml.match(/name="flowtoken"[^>]*value="([^"]+)"/si);

    // Try the JSON API endpoint
    if (canaryMatch) {
      const jsonPayload = {
        NewPassword: newPassword,
        ConfirmPassword: newPassword,
        canary: canaryMatch[1],
      };
      if (sCtxMatch) jsonPayload.sCtx = sCtxMatch[1];
      if (flowTokenMatch) jsonPayload.flowtoken = flowTokenMatch[1];

      // Find the API endpoint
      const apiUrl = pageUrl.replace(/\/password\/.*$/i, "/API/ResetPassword") ||
                     "https://account.live.com/API/ResetPassword";

      try {
        const { text: apiResult, res } = await sessionFetch(apiUrl, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Referer: pageUrl,
            canary: canaryMatch[1],
          },
          body: JSON.stringify(jsonPayload),
        }, cookieJar);

        if (res.status === 200) {
          try {
            const data = JSON.parse(apiResult);
            if (data.HasSucceeded || data.Success || data.success) {
              return { success: true, message: "Password reset successfully" };
            }
            if (data.Error || data.error) {
              return { success: false, error: data.Error || data.error || "API error" };
            }
          } catch {}
          // If not JSON, check for success indicators
          if (apiResult.includes("success") || apiResult.includes("Success") || apiResult.includes("PasswordReset")) {
            return { success: true, message: "Password reset successfully" };
          }
        }
      } catch {}
    }

    // Fallback: form-based submission
    formBody.append("NewPassword", newPassword);
    formBody.append("ConfirmPassword", newPassword);
    if (flowTokenMatch) formBody.append("flowtoken", flowTokenMatch[1]);
    if (canaryMatch) formBody.append("canary", canaryMatch[1]);

    // Include all hidden fields
    const hiddenFields = [...pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/gi)];
    for (const [, name, value] of hiddenFields) {
      if (!formBody.has(name)) formBody.append(name, value);
    }

    let actionUrl = pageUrl;
    const formAction = pageHtml.match(/<form[^>]*action="([^"]+)"[^>]*>/s);
    if (formAction) {
      actionUrl = formAction[1].startsWith("http") ? formAction[1] : new URL(formAction[1], pageUrl).href;
    }

    const { text: resultPage, finalUrl } = await sessionFetch(actionUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: pageUrl,
      },
      body: formBody.toString(),
    }, cookieJar);

    // Check success indicators
    if (resultPage.includes("PasswordChanged") || resultPage.includes("HasSucceeded") ||
        resultPage.includes("password has been reset") || resultPage.includes("successfully")) {
      return { success: true, message: "Password reset successfully" };
    }

    // Check for errors
    const errorMatch = resultPage.match(/id="error[^"]*"[^>]*>([^<]+)</s) ||
                       resultPage.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</s);
    if (errorMatch) {
      return { success: false, error: errorMatch[1].trim() };
    }

    return { success: false, error: "Could not determine if password was reset. Final page URL: " + finalUrl };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Download a CAPTCHA image and return it as a Buffer.
 */
async function downloadCaptchaImage(imageUrl, cookieJar = [], headers = {}) {
  try {
    const res = await proxiedFetch(imageUrl, {
      headers: {
        ...BROWSER_HEADERS,
        ...headers,
        Cookie: getCookieString(cookieJar),
      },
    });
    if (res.status !== 200) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

module.exports = {
  initiateRecovery,
  submitCaptchaAndContinue,
  submitNewPassword,
  downloadCaptchaImage,
  extractCaptchaInfo,
};
