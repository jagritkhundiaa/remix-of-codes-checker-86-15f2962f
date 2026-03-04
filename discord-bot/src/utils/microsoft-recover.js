// ============================================================
//  Microsoft Account Recovery (ACSR) via raw HTTP requests
//  Manual CAPTCHA mode — bot sends captcha image to Discord,
//  user replies with solution, bot completes recovery.
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

// ── Debug logging ────────────────────────────────────────────

const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log("[ACSR]", ...args);
}

// ── Cookie-aware session fetch ───────────────────────────────

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  extractFromResponse(res) {
    // Try getSetCookie first (modern), then fallback
    let setCookies = [];
    if (typeof res.headers.getSetCookie === "function") {
      setCookies = res.headers.getSetCookie();
    } else {
      const raw = res.headers.get("set-cookie");
      if (raw) setCookies = raw.split(/,(?=\s*\w+=)/);
    }
    for (const c of setCookies) {
      const pair = c.split(";")[0].trim();
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        const name = pair.substring(0, eqIdx).trim();
        const value = pair.substring(eqIdx + 1).trim();
        this.cookies.set(name, value);
      }
    }
  }

  toString() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/**
 * Fetch with cookie management, redirect following, and intermediate page handling.
 * Handles: HTTP redirects, meta refresh, JS location.replace, JS-disabled forms.
 */
async function sessionFetch(url, options, cookieJar, label = "") {
  let currentUrl = url;
  let method = options.method || "GET";
  let body = options.body;
  let maxRedirects = 60;

  const seenTransitions = new Map();
  const trail = [];

  while (maxRedirects-- > 0) {
    const bodyKey = typeof body === "string" ? body.slice(0, 180) : "";
    const transitionKey = `${method} ${currentUrl} ${bodyKey}`;
    const seenCount = (seenTransitions.get(transitionKey) || 0) + 1;
    seenTransitions.set(transitionKey, seenCount);

    if (seenCount > 4) {
      throw new Error(`Redirect loop detected at ${currentUrl}`);
    }

    log(`${label} ${method} ${currentUrl}`);

    const res = await proxiedFetch(currentUrl, {
      ...options,
      method,
      body,
      headers: {
        ...options.headers,
        Cookie: cookieJar.toString(),
      },
      redirect: "manual",
    });

    cookieJar.extractFromResponse(res);

    const status = res.status;
    trail.push(`${status}:${currentUrl}`);
    log(`${label} -> ${status}`);

    // HTTP redirect
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (!location) break;

      const nextUrl = resolveUrl(location, currentUrl);
      log(`${label} redirect -> ${nextUrl}`);

      if (nextUrl === currentUrl) {
        const text = await res.text();
        return { res, text, finalUrl: currentUrl };
      }

      currentUrl = nextUrl;
      if (status !== 307 && status !== 308) {
        method = "GET";
        body = undefined;
      }
      try { await res.text(); } catch {}
      continue;
    }

    const text = await res.text();

    // If we already have meaningful recovery markers, stop auto-following and return this page.
    if (hasRecoveryPageMarkers(text)) {
      return { res, text, finalUrl: currentUrl };
    }

    // Check for JS-disabled / intermediate pages and auto-submit
    const intermediateResult = detectIntermediatePage(text, currentUrl);
    if (intermediateResult) {
      log(`${label} intermediate page detected: ${intermediateResult.type}`);

      if (!intermediateResult.url) {
        return { res, text, finalUrl: currentUrl };
      }

      if (intermediateResult.type === "meta_refresh" || intermediateResult.type === "js_redirect") {
        const nextUrl = intermediateResult.url;
        if (nextUrl === currentUrl) {
          return { res, text, finalUrl: currentUrl };
        }
        currentUrl = nextUrl;
        method = "GET";
        body = undefined;
        continue;
      }

      if (intermediateResult.type === "auto_form") {
        const nextUrl = intermediateResult.url;
        const nextBody = intermediateResult.body || "";

        if (nextUrl === currentUrl && method === "POST" && (typeof body === "string" ? body : "") === nextBody) {
          return { res, text, finalUrl: currentUrl };
        }

        currentUrl = nextUrl;
        method = "POST";
        body = nextBody;
        options = {
          ...options,
          headers: {
            ...options.headers,
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: intermediateResult.referer,
            "Sec-Fetch-Site": "same-origin",
          },
        };
        continue;
      }
    }

    return { res, text, finalUrl: currentUrl };
  }

  throw new Error(`Too many redirects (${trail.slice(-12).join(" -> ")})`);
}

/**
 * Detect intermediate/transitional pages that need auto-processing.
 */
function detectIntermediatePage(html, pageUrl) {
  // Meta refresh: <meta http-equiv="refresh" content="0;url=...">
  const metaMatch = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)["']/i);
  if (metaMatch) {
    return { type: "meta_refresh", url: resolveUrl(metaMatch[1], pageUrl) };
  }

  // JS redirect: location.replace("...") or location.href = "..."
  const jsLocMatch = html.match(/location\.(?:replace|href)\s*=\s*["']([^"']+)["']/);
  if (jsLocMatch) {
    return { type: "js_redirect", url: resolveUrl(jsLocMatch[1], pageUrl) };
  }

  // JS-disabled form auto-submit: <noscript> or jsDisabled patterns
  if (html.includes("jsDisabled") || html.includes("fmHF")) {
    // Extract hidden form and auto-submit it
    const formAction = html.match(/<form[^>]*(?:id=["']fmHF["']|name=["']fmHF["'])[^>]*action=["']([^"']+)["']/i) ||
                       html.match(/<form[^>]*action=["']([^"']+)["'][^>]*(?:id=["']fmHF["']|name=["']fmHF["'])/i);
    if (formAction) {
      const actionUrl = resolveUrl(formAction[1], pageUrl);
      const hiddenFields = extractHiddenFields(html);
      const formBody = new URLSearchParams(hiddenFields).toString();
      return { type: "auto_form", url: actionUrl, body: formBody, referer: pageUrl };
    }
  }

  // Generic auto-submit form (single form with only hidden fields + submit)
  const autoSubmitMatch = html.match(/document\.forms\[0\]\.submit\(\)/);
  if (autoSubmitMatch) {
    const formAction = html.match(/<form[^>]*action=["']([^"']+)["']/i);
    if (formAction) {
      const actionUrl = resolveUrl(formAction[1], pageUrl);
      const hiddenFields = extractHiddenFields(html);
      const formBody = new URLSearchParams(hiddenFields).toString();
      return { type: "auto_form", url: actionUrl, body: formBody, referer: pageUrl };
    }
  }

  return null;
}

/**
 * Stop auto-navigation if page already contains meaningful recovery markers.
 */
function hasRecoveryPageMarkers(html) {
  return [
    "name=\"PPFT\"",
    "urlPost",
    "sFTTag",
    "flowtoken",
    "ProofConfirmation",
    "hipImage",
    "funcaptcha",
    "ResetPassword",
    "NewPassword",
    "iResetPwdInput",
  ].some((marker) => html.includes(marker));
}

/**
 * Extract all hidden input fields from HTML.
 */
function extractHiddenFields(html) {
  const fields = {};
  const regex = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = tag.match(/name=["']([^"']+)["']/i);
    const valueMatch = tag.match(/value=["']([^"']*?)["']/i);
    if (nameMatch) {
      fields[nameMatch[1]] = valueMatch ? valueMatch[1] : "";
    }
  }
  return fields;
}

/**
 * Safely resolve a URL (relative or absolute) against a base.
 */
function resolveUrl(target, base) {
  if (!target) return base;
  if (target.startsWith("http://") || target.startsWith("https://")) return target;
  try {
    return new URL(target, base).href;
  } catch {
    // If base is also bad, try constructing from known domain
    try {
      return new URL(target, "https://account.live.com").href;
    } catch {
      return target;
    }
  }
}

// ── Common headers ───────────────────────────────────────────

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua": '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
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
  const cookieJar = new CookieJar();
  const headers = { ...BROWSER_HEADERS };

  try {
    log("=== PHASE 1: Initiate Recovery for", email, "===");

    // Step 1: Load the ACSR page (follow all redirects/intermediate pages)
    const { text: acsrPage, finalUrl } = await sessionFetch(ACSR_START_URL, {
      headers,
    }, cookieJar, "[init]");

    log("[init] Landed on:", finalUrl);
    log("[init] Page length:", acsrPage.length);

    // Extract key tokens from the page
    const pageTokens = extractPageTokens(acsrPage);
    log("[init] Tokens found:", Object.keys(pageTokens).filter(k => pageTokens[k]).join(", "));

    // Find the form submission URL
    let urlPost = pageTokens.urlPost;
    if (!urlPost) {
      const formMatch = acsrPage.match(/<form[^>]*action=["']([^"']+)["'][^>]*>/i);
      if (formMatch) urlPost = resolveUrl(formMatch[1], finalUrl);
    }
    if (!urlPost) {
      // Try urlGenericError or any API endpoint
      const apiMatch = acsrPage.match(/["']([^"']*\/GetCredentialType[^"']*)["']/i);
      if (apiMatch) urlPost = resolveUrl(apiMatch[1], finalUrl);
    }

    if (!urlPost) {
      log("[init] ERROR: No form URL found");
      log("[init] Page snippet:", acsrPage.substring(0, 500));
      return { success: false, error: "Could not find ACSR form URL. Page: " + finalUrl, phase: "init" };
    }

    urlPost = resolveUrl(urlPost, finalUrl);
    log("[init] Posting email to:", urlPost);

    // Step 2: Submit the email address
    const formBody = new URLSearchParams();
    formBody.append("login", email);
    formBody.append("loginfmt", email);
    if (pageTokens.ppft) formBody.append("PPFT", pageTokens.ppft);
    if (pageTokens.canary) formBody.append("canary", pageTokens.canary);
    if (pageTokens.flowToken) formBody.append("flowtoken", pageTokens.flowToken);

    // Also include all hidden fields from the page
    const hiddenFields = extractHiddenFields(acsrPage);
    for (const [name, value] of Object.entries(hiddenFields)) {
      if (!formBody.has(name)) formBody.append(name, value);
    }

    const { text: emailPage, finalUrl: emailFinalUrl } = await sessionFetch(urlPost, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: finalUrl,
        Origin: new URL(finalUrl).origin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: formBody.toString(),
    }, cookieJar, "[email-submit]");

    log("[email-submit] Landed on:", emailFinalUrl);
    log("[email-submit] Page length:", emailPage.length);

    // Analyze the result page
    return analyzeResultPage(emailPage, emailFinalUrl, email, cookieJar, headers);

  } catch (err) {
    log("[init] ERROR:", err.message);
    return { success: false, error: err.message, phase: "init" };
  }
}

/**
 * Extract all useful tokens from a Microsoft page.
 */
function extractPageTokens(html) {
  const tokens = {
    ppft: null,
    urlPost: null,
    canary: null,
    flowToken: null,
    sCtx: null,
    sessionId: null,
    correlationId: null,
  };

  // PPFT / sFT
  const ppftPatterns = [
    /sFT\s*[:=]\s*'([^']+)'/,
    /name="PPFT"[^>]*value="([^"]+)"/i,
    /"sFT"\s*:\s*"([^"]+)"/,
    /sFTTag\s*[:=]\s*'[^']*value="([^"]+)'/,
  ];
  for (const p of ppftPatterns) {
    const m = html.match(p);
    if (m) { tokens.ppft = m[1]; break; }
  }

  // urlPost
  const urlPostPatterns = [
    /urlPost\s*[:=]\s*'([^']+)'/,
    /"urlPost"\s*:\s*"([^"]+)"/,
  ];
  for (const p of urlPostPatterns) {
    const m = html.match(p);
    if (m) { tokens.urlPost = m[1]; break; }
  }

  // Canary
  const canaryPatterns = [
    /canary\s*[:=]\s*"([^"]+)"/,
    /"canary"\s*:\s*"([^"]+)"/,
    /apiCanary\s*[:=]\s*"([^"]+)"/,
    /"apiCanary"\s*:\s*"([^"]+)"/,
  ];
  for (const p of canaryPatterns) {
    const m = html.match(p);
    if (m) { tokens.canary = m[1]; break; }
  }

  // Flow token
  tokens.flowToken = tokens.ppft; // Often the same

  // sCtx
  const sCtxMatch = html.match(/sCtx\s*[:=]\s*"([^"]+)"/) || html.match(/"sCtx"\s*:\s*"([^"]+)"/);
  if (sCtxMatch) tokens.sCtx = sCtxMatch[1];

  // Session ID
  const sidMatch = html.match(/sessionId\s*[:=]\s*["']([^"']+)["']/) || html.match(/"sessionId"\s*:\s*"([^"]+)"/);
  if (sidMatch) tokens.sessionId = sidMatch[1];

  // Correlation ID
  const corrMatch = html.match(/correlationId\s*[:=]\s*["']([^"']+)["']/);
  if (corrMatch) tokens.correlationId = corrMatch[1];

  return tokens;
}

/**
 * Analyze a result page after email submission or CAPTCHA submission.
 */
function analyzeResultPage(html, pageUrl, email, cookieJar, headers) {
  log("[analyze] URL:", pageUrl);

  // Check for password reset page
  if (html.includes("iResetPwdInput") || html.includes("NewPassword") ||
      html.includes("newPassword") || html.includes("ResetPassword") ||
      html.includes("resetPassword") || html.includes("PasswordReset") ||
      pageUrl.includes("password/reset") || pageUrl.includes("password/Reset") ||
      pageUrl.includes("ResetPassword")) {
    log("[analyze] -> password_reset page detected");
    return {
      success: true,
      phase: "password_reset",
      email,
      cookieJar,
      headers,
      pageHtml: html,
      pageUrl,
    };
  }

  // Check for CAPTCHA
  const captchaInfo = extractCaptchaInfo(html, pageUrl);
  if (captchaInfo.hasCaptcha) {
    log("[analyze] -> CAPTCHA detected, type:", captchaInfo.type);
    return {
      success: true,
      phase: "captcha_required",
      email,
      captchaInfo,
      cookieJar,
      headers,
      pageHtml: html,
      pageUrl,
    };
  }

  // Check for identity verification page
  const verifyInfo = extractVerificationOptions(html);
  if (verifyInfo.hasOptions) {
    log("[analyze] -> verification options detected");
    return {
      success: true,
      phase: "verify_identity",
      email,
      verifyInfo,
      cookieJar,
      headers,
      pageHtml: html,
      pageUrl,
    };
  }

  // Check for error messages
  const errorPatterns = [
    /id="error[^"]*"[^>]*>([^<]+)</i,
    /class="[^"]*error[^"]*"[^>]*>([^<]+)</i,
    /data-bind="text:\s*(?:str|unsafe)\.[^"]*"[^>]*>([^<]+)</i,
    /"sErrTxt"\s*:\s*"([^"]+)"/,
    /sErrorCode\s*[:=]\s*"([^"]+)"/,
  ];
  for (const p of errorPatterns) {
    const m = html.match(p);
    if (m && m[1].trim().length > 0) {
      const errText = m[1].trim().replace(/\\u[\dA-Fa-f]{4}/g, (match) =>
        String.fromCharCode(parseInt(match.replace("\\u", ""), 16))
      );
      log("[analyze] -> error found:", errText);
      return { success: false, error: errText, phase: "error" };
    }
  }

  // Check for "account doesn't exist" type messages
  if (html.includes("AADSTS50034") || html.includes("account doesn't exist") ||
      html.includes("couldn't find an account")) {
    log("[analyze] -> account not found");
    return { success: false, error: "Account not found", phase: "error" };
  }

  // Unknown page — log snippet for debugging
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  log("[analyze] -> unknown page. Title:", title ? title[1] : "none");
  log("[analyze] -> URL:", pageUrl);
  log("[analyze] -> Snippet:", html.substring(0, 800).replace(/\s+/g, " "));

  return {
    success: true,
    phase: "unknown_page",
    email,
    cookieJar,
    headers,
    pageHtml: html.substring(0, 3000),
    pageUrl,
  };
}

/**
 * Extract CAPTCHA challenge info from the page.
 */
function extractCaptchaInfo(html, pageUrl) {
  const result = {
    hasCaptcha: false,
    type: null,
    siteKey: null,
    captchaUrl: null,
    imageUrl: null,
    sessionId: null,
    flowToken: null,
  };

  // Check for FunCaptcha / Arkose Labs
  const arkosePatterns = [
    /public_key\s*[:=]\s*["']([^"']+)["']/,
    /data-pkey\s*=\s*["']([^"']+)["']/,
    /"siteKey"\s*:\s*"([^"]+)"/,
    /enforcement\.([A-Fa-f0-9-]+)/,
  ];
  for (const p of arkosePatterns) {
    const m = html.match(p);
    if (m) {
      result.hasCaptcha = true;
      result.type = "funcaptcha";
      result.siteKey = m[1];
      break;
    }
  }

  // Check for HIP image captcha
  const hipPatterns = [
    /hipUrl\s*[:=]\s*["']([^"']+)["']/,
    /<img[^>]*id=["']hipImage["'][^>]*src=["']([^"']+)["']/i,
    /HipImageUrl\s*[:=]\s*["']([^"']+)["']/,
    /["']hipImageUrl["']\s*:\s*["']([^"']+)["']/,
  ];
  for (const p of hipPatterns) {
    const m = html.match(p);
    if (m) {
      result.hasCaptcha = true;
      result.type = "hip";
      result.imageUrl = resolveUrl(m[1], pageUrl);
      break;
    }
  }

  // Check for generic captcha markers
  if (!result.hasCaptcha) {
    const markers = ["captcha", "CAPTCHA", "hip_solution", "enforcement", "funcaptcha", "arkose"];
    if (markers.some(m => html.includes(m))) {
      result.hasCaptcha = true;
      result.type = "unknown";
    }
  }

  // Extract flow token
  const ftPatterns = [
    /sFT\s*[:=]\s*'([^']+)'/,
    /name=["']flowtoken["'][^>]*value=["']([^"']+)["']/i,
    /"sFT"\s*:\s*"([^"]+)"/,
  ];
  for (const p of ftPatterns) {
    const m = html.match(p);
    if (m) { result.flowToken = m[1]; break; }
  }

  // Extract session ID
  const sidPatterns = [
    /sessionId\s*[:=]\s*["']([^"']+)["']/,
    /name=["']session["'][^>]*value=["']([^"']+)["']/i,
  ];
  for (const p of sidPatterns) {
    const m = html.match(p);
    if (m) { result.sessionId = m[1]; break; }
  }

  return result;
}

/**
 * Extract identity verification options (email/phone choices).
 */
function extractVerificationOptions(html) {
  const result = { hasOptions: false, options: [] };

  // Look for proof options (masked emails, phone numbers)
  const proofRegex = /data-bind="[^"]*ProofConfirmation[^"]*"[^>]*>([^<]+)</g;
  let match;
  while ((match = proofRegex.exec(html)) !== null) {
    result.options.push({ index: result.options.length, label: match[1].trim() });
  }
  if (result.options.length > 0) {
    result.hasOptions = true;
    return result;
  }

  // Alternative: radio buttons with proof options
  const radioRegex = /<input[^>]*name=["']Proof["'][^>]*value=["']([^"']+)["'][^>]*>/g;
  const radioValues = [];
  while ((match = radioRegex.exec(html)) !== null) {
    radioValues.push(match[1]);
  }
  // Try to find corresponding labels
  if (radioValues.length > 0) {
    const labelRegex = /<label[^>]*>([^<]+)<\/label>/g;
    const labels = [];
    while ((match = labelRegex.exec(html)) !== null) {
      labels.push(match[1].trim());
    }
    for (let i = 0; i < radioValues.length; i++) {
      result.options.push({
        index: i,
        value: radioValues[i],
        label: labels[i] || radioValues[i],
      });
    }
    result.hasOptions = true;
  }

  return result;
}

/**
 * Phase 2: Submit CAPTCHA solution and continue recovery.
 */
async function submitCaptchaAndContinue(session, captchaSolution) {
  const { cookieJar, headers, pageHtml, pageUrl, captchaInfo } = session;

  try {
    log("=== PHASE 2: Submit CAPTCHA ===");
    log("[captcha] Type:", captchaInfo.type);

    // Build the CAPTCHA submission form
    const formBody = new URLSearchParams();

    // Add hidden fields first
    const hiddenFields = extractHiddenFields(pageHtml);
    for (const [name, value] of Object.entries(hiddenFields)) {
      formBody.append(name, value);
    }

    // Add the CAPTCHA solution
    if (captchaInfo.type === "hip") {
      formBody.set("hip_solution", captchaSolution);
    } else if (captchaInfo.type === "funcaptcha") {
      formBody.set("fc_token", captchaSolution);
    } else {
      formBody.set("hip_solution", captchaSolution);
      formBody.set("hip_answer", captchaSolution);
    }

    // Ensure flow token is present
    if (captchaInfo.flowToken) formBody.set("flowtoken", captchaInfo.flowToken);
    if (captchaInfo.sessionId) formBody.set("session", captchaInfo.sessionId);

    // Find the form action URL
    let actionUrl = pageUrl;
    const formAction = pageHtml.match(/<form[^>]*action=["']([^"']+)["']/i);
    if (formAction) {
      actionUrl = resolveUrl(formAction[1], pageUrl);
    }
    log("[captcha] Posting to:", actionUrl);

    const { text: resultPage, finalUrl } = await sessionFetch(actionUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: pageUrl,
        Origin: new URL(pageUrl).origin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: formBody.toString(),
    }, cookieJar, "[captcha-submit]");

    return analyzeResultPage(resultPage, finalUrl, session.email, cookieJar, headers);

  } catch (err) {
    log("[captcha] ERROR:", err.message);
    return { success: false, error: err.message, phase: "captcha_submit" };
  }
}

/**
 * Phase 3: Submit the new password on the password reset page.
 */
async function submitNewPassword(session, newPassword) {
  const { cookieJar, headers, pageHtml, pageUrl } = session;

  try {
    log("=== PHASE 3: Submit New Password ===");
    log("[password] Page URL:", pageUrl);

    const tokens = extractPageTokens(pageHtml);

    // Method 1: Try JSON API (modern Microsoft flow)
    if (tokens.canary) {
      log("[password] Trying JSON API...");
      const jsonPayload = {
        NewPassword: newPassword,
        ConfirmPassword: newPassword,
        canary: tokens.canary,
      };
      if (tokens.sCtx) jsonPayload.sCtx = tokens.sCtx;
      if (tokens.ppft) jsonPayload.flowtoken = tokens.ppft;

      // Try multiple API endpoints
      const apiEndpoints = [
        pageUrl.replace(/\/[^\/]*$/, "/ResetPassword"),
        pageUrl.replace(/\/password\/.*$/i, "/API/ResetPassword"),
        "https://account.live.com/API/ResetPassword",
      ];

      for (const apiUrl of apiEndpoints) {
        try {
          log("[password] Trying API endpoint:", apiUrl);
          const { text: apiResult, res } = await sessionFetch(apiUrl, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
              Referer: pageUrl,
              Origin: new URL(pageUrl).origin,
              canary: tokens.canary,
              hpgid: "",
              "Sec-Fetch-Site": "same-origin",
            },
            body: JSON.stringify(jsonPayload),
          }, cookieJar, "[pw-json]");

          log("[password] API response status:", res.status, "body:", apiResult.substring(0, 200));

          if (res.status === 200) {
            try {
              const data = JSON.parse(apiResult);
              if (data.HasSucceeded || data.Success || data.success) {
                return { success: true, message: "Password reset successfully" };
              }
              if (data.Error || data.error) {
                log("[password] API error:", data.Error || data.error);
                // Don't return yet, try next endpoint or fallback
                continue;
              }
            } catch {}
            if (apiResult.includes("success") || apiResult.includes("Success")) {
              return { success: true, message: "Password reset successfully" };
            }
          }
        } catch (e) {
          log("[password] API endpoint failed:", e.message);
        }
      }
    }

    // Method 2: Form-based submission (fallback)
    log("[password] Trying form submission...");
    const formBody = new URLSearchParams();

    // Add all hidden fields
    const hiddenFields = extractHiddenFields(pageHtml);
    for (const [name, value] of Object.entries(hiddenFields)) {
      formBody.append(name, value);
    }

    formBody.set("NewPassword", newPassword);
    formBody.set("ConfirmPassword", newPassword);
    if (tokens.ppft) formBody.set("flowtoken", tokens.ppft);
    if (tokens.canary) formBody.set("canary", tokens.canary);

    // Also try alternative field names
    formBody.set("passwd", newPassword);
    formBody.set("passwdConfirm", newPassword);

    let actionUrl = pageUrl;
    const formAction = pageHtml.match(/<form[^>]*action=["']([^"']+)["']/i);
    if (formAction) {
      actionUrl = resolveUrl(formAction[1], pageUrl);
    }
    log("[password] Posting form to:", actionUrl);

    const { text: resultPage, finalUrl } = await sessionFetch(actionUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: pageUrl,
        Origin: new URL(pageUrl).origin,
        "Sec-Fetch-Site": "same-origin",
      },
      body: formBody.toString(),
    }, cookieJar, "[pw-form]");

    log("[password] Form result URL:", finalUrl);

    // Check success indicators
    const successIndicators = [
      "PasswordChanged", "HasSucceeded", "password has been reset",
      "successfully", "password has been changed", "PasswordReset",
    ];
    if (successIndicators.some(s => resultPage.includes(s))) {
      return { success: true, message: "Password reset successfully" };
    }

    // Check for errors
    const errorPatterns = [
      /id="error[^"]*"[^>]*>([^<]+)</i,
      /class="[^"]*error[^"]*"[^>]*>([^<]+)</i,
      /"sErrTxt"\s*:\s*"([^"]+)"/,
    ];
    for (const p of errorPatterns) {
      const m = resultPage.match(p);
      if (m) return { success: false, error: m[1].trim() };
    }

    return { success: false, error: "Could not determine password reset result. Final URL: " + finalUrl };
  } catch (err) {
    log("[password] ERROR:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Download a CAPTCHA image and return it as a Buffer.
 */
async function downloadCaptchaImage(imageUrl, cookieJar = new CookieJar(), headers = {}) {
  try {
    log("[captcha-img] Downloading:", imageUrl);
    const res = await proxiedFetch(imageUrl, {
      headers: {
        ...BROWSER_HEADERS,
        ...headers,
        Cookie: typeof cookieJar === "object" && cookieJar.toString ? cookieJar.toString() : "",
      },
    });
    if (res.status !== 200) {
      log("[captcha-img] Failed with status:", res.status);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    log("[captcha-img] ERROR:", e.message);
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
