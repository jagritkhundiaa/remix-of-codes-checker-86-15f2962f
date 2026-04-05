import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;
const OWNER_ID = 5342093297;

Deno.serve(async () => {
  const startTime = Date.now();

  const botToken = Deno.env.get('SCRAPER_TG_BOT_TOKEN');
  if (!botToken) {
    return new Response(JSON.stringify({ error: 'Missing SCRAPER_TG_BOT_TOKEN' }), { status: 500 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let totalProcessed = 0;

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('update_offset')
    .eq('id', 1)
    .single();

  if (stateErr) {
    return new Response(JSON.stringify({ error: stateErr.message }), { status: 500 });
  }

  let currentOffset = state.update_offset;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;

    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: currentOffset, timeout, allowed_updates: ['message'] }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data }), { status: 502 });
    }

    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    for (const update of updates) {
      const msg = update.message;
      if (!msg) continue;

      const chatId = msg.chat.id;
      const userId = msg.from?.id || chatId;
      const text = (msg.text || msg.caption || '').trim();

      if (!text) continue;

      const isOwner = userId === OWNER_ID;
      const isAuthed = isOwner || await checkAuth(supabase, userId);

      if (!isAuthed) {
        await sendTg(botToken, chatId, '⛔ Unauthorized. Ask the owner for access.');
        continue;
      }

      try {
        await handleCommand(supabase, supabaseUrl, supabaseKey, botToken, chatId, userId, isOwner, text, msg);
      } catch (e) {
        console.error('Command error:', e);
        await sendTg(botToken, chatId, `❌ Error: ${e instanceof Error ? e.message : 'unknown'}`);
      }

      totalProcessed++;
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed }));
});

// ── Auth helpers ──
async function checkAuth(supabase: any, userId: number): Promise<boolean> {
  const { data } = await supabase
    .from('scraper_bot_auth')
    .select('expires_at')
    .eq('user_id', String(userId))
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return false;
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase.from('scraper_bot_auth').update({ is_active: false }).eq('user_id', String(userId));
    return false;
  }
  return true;
}

function parseDuration(s: string): number | null {
  const m = s.match(/^(\d+)(m|h|d|w|mo)$/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  const multipliers: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000 };
  return n * (multipliers[unit] || 0) * 1000;
}

// ── Telegram helpers ──
async function sendTg(token: string, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}

async function sendTgDocument(token: string, chatId: number, filename: string, content: string, caption?: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', blob, filename);
  if (caption) form.append('caption', caption);
  form.append('parse_mode', 'HTML');

  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
}

async function downloadTgFile(token: string, fileId: string): Promise<string> {
  const fileResp = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const fileData = await fileResp.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error('Could not get file path');

  const dlResp = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  return await dlResp.text();
}

// ── 2D/3D Gate Check ──
async function checkStripeGate(stripePk: string): Promise<{ gateType: '2d' | '3d' | 'unknown'; details: string }> {
  try {
    const guid = crypto.randomUUID().replace(/-/g, '');
    const muid = crypto.randomUUID().replace(/-/g, '');
    const sid = crypto.randomUUID().replace(/-/g, '');

    const pmBody = new URLSearchParams({
      'type': 'card',
      'card[number]': '4242424242424242',
      'card[exp_month]': '12',
      'card[exp_year]': '28',
      'card[cvc]': '123',
      'billing_details[address][country]': 'US',
      'billing_details[address][postal_code]': '10001',
      'guid': guid,
      'muid': muid,
      'sid': sid,
      'payment_user_agent': 'stripe.js/v3',
      'time_on_page': String(30000 + Math.floor(Math.random() * 20000)),
      'key': stripePk,
    });

    const pmResp = await fetch('https://api.stripe.com/v1/payment_methods', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
      },
      body: pmBody.toString(),
    });

    const pmData = await pmResp.json();

    if (pmData.error) {
      return { gateType: 'unknown', details: `PM error: ${pmData.error.code || pmData.error.message}` };
    }

    const threeDSecure = pmData.card?.three_d_secure_usage?.supported;

    if (threeDSecure === false) {
      return { gateType: '2d', details: '3DS not supported — 2D ✅' };
    }

    // Try 3DS-required test card
    const tokenBody = new URLSearchParams({
      'card[number]': '4000000000003220',
      'card[exp_month]': '12',
      'card[exp_year]': '28',
      'card[cvc]': '123',
      'key': stripePk,
    });

    const tokenResp = await fetch('https://api.stripe.com/v1/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
      },
      body: tokenBody.toString(),
    });

    const tokenData = await tokenResp.json();

    if (tokenData.error) {
      if (tokenData.error.code === 'card_declined') {
        return { gateType: '2d', details: 'Declined without 3DS — 2D ✅' };
      }
      return { gateType: 'unknown', details: `Token error: ${tokenData.error.code}` };
    }

    if (threeDSecure === true) {
      return { gateType: '3d', details: '3DS supported/required — 3D 🔐' };
    }

    return { gateType: '2d', details: 'No 3DS enforcement — 2D ✅' };
  } catch (e) {
    return { gateType: 'unknown', details: `Error: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

// ── Site Analysis ──
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function detectProvider(url: string, html: string): string {
  const u = url.toLowerCase();
  const h = html.toLowerCase();
  if (u.includes('stripe.com') || h.includes('js.stripe.com') || h.includes('stripe.js') || h.includes('pk_live_') || h.includes('pk_test_')) return 'stripe';
  if (h.includes('adyen') || u.includes('adyen') || h.includes('adyencheckout') || h.includes('adyen-checkout')) return 'adyen';
  if (h.includes('braintree') || h.includes('braintreegateway')) return 'braintree';
  if (h.includes('checkout.com') || h.includes('frames.checkout.com')) return 'checkout';
  if (h.includes('paypal') || u.includes('paypal')) return 'paypal';
  if (h.includes('square') || h.includes('squareup')) return 'square';
  return 'unknown';
}

function extractStripePk(html: string): string | null {
  const patterns = [/pk_live_[A-Za-z0-9]{20,}/, /pk_test_[A-Za-z0-9]{20,}/];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[0];
  }
  return null;
}

async function analyzeSiteUrl(url: string): Promise<{
  domain: string; gateway: string; stripePk: string | null;
  gateType: '2d' | '3d' | 'unknown'; gateDetails: string;
  requiresPhone: boolean; error?: string;
}> {
  const result = { domain: '', gateway: 'unknown', stripePk: null as string | null, gateType: 'unknown' as '2d' | '3d' | 'unknown', gateDetails: '', requiresPhone: false, error: undefined as string | undefined };

  try {
    const parsedUrl = new URL(url);
    result.domain = parsedUrl.hostname;

    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENTS[0] },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      result.error = `HTTP ${resp.status}`;
      return result;
    }

    const html = await resp.text();
    result.gateway = detectProvider(url, html);
    result.stripePk = extractStripePk(html);

    const h = html.toLowerCase();
    result.requiresPhone = (h.includes('phone number') || h.includes('mobile number') || h.includes('type="tel"')) && (h.includes('required') || h.includes('verify'));

    // Check subpages if unknown
    if (result.gateway === 'unknown') {
      for (const path of ['/pricing', '/checkout', '/payment', '/subscribe', '/plans', '/donate', '/buy']) {
        try {
          const r2 = await fetch(`${parsedUrl.origin}${path}`, {
            headers: { 'User-Agent': USER_AGENTS[0] },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          if (r2.ok) {
            const h2 = await r2.text();
            const provider = detectProvider(`${parsedUrl.origin}${path}`, h2);
            if (provider !== 'unknown') {
              result.gateway = provider;
              result.stripePk = result.stripePk || extractStripePk(h2);
              break;
            }
          }
        } catch { /* skip */ }
      }
    }

    // If stripe with pk, check gate type
    if (result.gateway === 'stripe' && result.stripePk) {
      const gate = await checkStripeGate(result.stripePk);
      result.gateType = gate.gateType;
      result.gateDetails = gate.details;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : 'unknown';
  }

  return result;
}

// ── Command handler ──
async function handleCommand(supabase: any, supabaseUrl: string, supabaseKey: string, botToken: string, chatId: number, userId: number, isOwner: boolean, text: string, msg: any) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/^\//, '').replace(/@.*$/, '');

  switch (cmd) {
    case 'start':
    case 'help': {
      let helpMsg = `🤖 <b>Scraper Bot</b>\n\n` +
        `<b>📋 Commands:</b>\n` +
        `/scrape — Run scraper (all categories)\n` +
        `/scrape [name] — Specific category\n` +
        `/sites — Get all sites as .txt\n` +
        `/sites 2d|3d|stripe|adyen — Filtered\n` +
        `/filter — Reply to .txt to check 2D/3D\n` +
        `/check [url] — Analyze single site\n` +
        `/cats — List categories\n` +
        `/stats — Statistics\n`;

      if (isOwner) {
        helpMsg += `\n<b>👑 Owner:</b>\n` +
          `/auth [uid] [duration] — Grant access\n` +
          `/deauth [uid] — Revoke\n` +
          `/authlist — List users\n` +
          `/addcat Name | q1, q2\n` +
          `/rmcat Name\n` +
          `/purge — Clear all sites\n`;
      }
      return sendTg(botToken, chatId, helpMsg);
    }

    case 'auth': {
      if (!isOwner) return sendTg(botToken, chatId, '⛔ Owner only.');
      const targetId = parts[1];
      const duration = parts[2];
      if (!targetId) return sendTg(botToken, chatId, '❌ Usage: /auth [user_id] [duration]\nDurations: 1h, 1d, 7d, 30d, 1mo');

      let expiresAt: string | null = null;
      let durationLabel = 'permanent';
      if (duration) {
        const ms = parseDuration(duration);
        if (!ms) return sendTg(botToken, chatId, '❌ Invalid duration.');
        expiresAt = new Date(Date.now() + ms).toISOString();
        durationLabel = duration;
      }

      await supabase.from('scraper_bot_auth').upsert({
        user_id: targetId, is_active: true, expires_at: expiresAt,
        granted_by: String(userId), granted_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      return sendTg(botToken, chatId, `✅ Authorized <code>${targetId}</code> (${durationLabel})`);
    }

    case 'deauth': {
      if (!isOwner) return sendTg(botToken, chatId, '⛔ Owner only.');
      const targetId = parts[1];
      if (!targetId) return sendTg(botToken, chatId, '❌ Usage: /deauth [user_id]');
      await supabase.from('scraper_bot_auth').update({ is_active: false }).eq('user_id', targetId);
      return sendTg(botToken, chatId, `🗑 Revoked <code>${targetId}</code>`);
    }

    case 'authlist': {
      if (!isOwner) return sendTg(botToken, chatId, '⛔ Owner only.');
      const { data: users } = await supabase.from('scraper_bot_auth').select('*').eq('is_active', true);
      if (!users?.length) return sendTg(botToken, chatId, '📭 No authorized users.');
      let authMsg = `👥 <b>Authorized Users</b>\n\n`;
      for (const u of users) {
        const exp = u.expires_at ? `expires ${new Date(u.expires_at).toLocaleDateString()}` : 'permanent';
        authMsg += `• <code>${u.user_id}</code> — ${exp}\n`;
      }
      return sendTg(botToken, chatId, authMsg);
    }

    case 'check': {
      const url = parts[1];
      if (!url || !url.startsWith('http')) return sendTg(botToken, chatId, '❌ Usage: /check https://example.com');

      await sendTg(botToken, chatId, `🔍 Analyzing <code>${url}</code>...`);
      const result = await analyzeSiteUrl(url);

      const gwIcon = result.gateway === 'stripe' ? '💳' : result.gateway === 'adyen' ? '🔷' : '❓';
      const gateIcon = result.gateType === '2d' ? '✅ 2D' : result.gateType === '3d' ? '🔐 3D' : '❓';

      let resultMsg = `${gwIcon} <b>${result.domain}</b>\n\n` +
        `Gateway: <b>${result.gateway}</b>\n` +
        `Gate: <b>${gateIcon}</b>\n`;
      if (result.stripePk) resultMsg += `Key: <code>${result.stripePk}</code>\n`;
      if (result.gateDetails) resultMsg += `Details: ${result.gateDetails}\n`;
      if (result.requiresPhone) resultMsg += `⚠️ Requires phone\n`;
      if (result.error) resultMsg += `Error: ${result.error}\n`;

      return sendTg(botToken, chatId, resultMsg);
    }

    case 'scrape': {
      const catName = parts.slice(1).join(' ').trim();
      await sendTg(botToken, chatId, `🔄 Starting scrape${catName ? ` for "${catName}"` : ' (all)'}...`);

      const fnBody: any = {};
      if (catName) {
        const { data: cat } = await supabase.from('scraper_categories').select('id').ilike('name', `%${catName}%`).maybeSingle();
        if (cat) fnBody.category_id = cat.id;
        else return sendTg(botToken, chatId, `❌ Category "${catName}" not found.`);
      }

      const fnResp = await fetch(`${supabaseUrl}/functions/v1/site-scraper`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fnBody),
      });

      const result = await fnResp.json();
      if (result.error) return sendTg(botToken, chatId, `❌ ${result.error}`);

      const r = result.results || {};

      // Now fetch all confirmed sites and send as .txt
      let query = supabase.from('scraped_sites')
        .select('url,domain,payment_gateway,status,gateway_details,stripe_pk')
        .in('status', ['confirmed'])
        .order('created_at', { ascending: false });

      const { data: sites } = await query;

      let summaryMsg = `✅ <b>Scrape Complete</b>\n\n` +
        `🔍 Discovered: ${r.discovered || 0}\n` +
        `📊 Analyzed: ${r.analyzed || 0}\n` +
        `✅ Confirmed: ${r.confirmed || 0}\n` +
        `🟢 2D: ${r.gates_2d || 0}\n` +
        `🔴 3D: ${r.gates_3d || 0}\n` +
        `⏭ Skipped: ${r.skipped || 0}\n` +
        `❌ Errors: ${r.errors || 0}`;

      await sendTg(botToken, chatId, summaryMsg);

      // Send confirmed sites as .txt file
      if (sites && sites.length > 0) {
        let txtContent = `# Scraper Results — ${new Date().toISOString().split('T')[0]}\n`;
        txtContent += `# Total: ${sites.length} confirmed sites\n`;
        txtContent += `# Reply to this file with /filter to check 2D/3D\n\n`;

        for (const s of sites) {
          const gw = s.payment_gateway || 'unknown';
          const gate = s.gateway_details?.gateType || 'unknown';
          const pk = s.stripe_pk || 'N/A';
          txtContent += `${s.url} | ${gw} | ${gate} | ${s.domain} | pk:${pk}\n`;
        }

        await sendTgDocument(botToken, chatId, `sites_${Date.now()}.txt`, txtContent, `📋 <b>${sites.length} confirmed sites</b>\nReply with /filter to check 2D/3D`);
      }

      return;
    }

    case 'sites': {
      const filter = parts[1]?.toLowerCase();
      let query = supabase.from('scraped_sites')
        .select('url,domain,payment_gateway,status,gateway_details,stripe_pk')
        .order('created_at', { ascending: false });

      if (filter === '2d') query = query.contains('gateway_details', { gateType: '2d' });
      else if (filter === '3d') query = query.contains('gateway_details', { gateType: '3d' });
      else if (filter === 'stripe') query = query.eq('payment_gateway', 'stripe');
      else if (filter === 'adyen') query = query.eq('payment_gateway', 'adyen');
      else if (filter === 'confirmed') query = query.eq('status', 'confirmed');
      else query = query.in('status', ['confirmed', 'analyzed']).in('payment_gateway', ['stripe', 'adyen', 'braintree', 'checkout']);

      const { data: sites } = await query;
      if (!sites?.length) return sendTg(botToken, chatId, '📭 No sites found.');

      let txtContent = `# Sites${filter ? ` [${filter}]` : ''} — ${new Date().toISOString().split('T')[0]}\n`;
      txtContent += `# Total: ${sites.length}\n`;
      txtContent += `# Reply with /filter to check each site 2D/3D\n\n`;

      for (const s of sites) {
        const gw = s.payment_gateway || 'unknown';
        const gate = s.gateway_details?.gateType || 'unchecked';
        const pk = s.stripe_pk || 'N/A';
        txtContent += `${s.url} | ${gw} | ${gate} | ${s.domain} | pk:${pk}\n`;
      }

      return sendTgDocument(botToken, chatId, `sites_${filter || 'all'}_${Date.now()}.txt`, txtContent, `📋 <b>${sites.length} sites</b>${filter ? ` [${filter}]` : ''}\nReply with /filter to check 2D/3D`);
    }

    case 'filter': {
      // Must be a reply to a file
      const replyMsg = msg.reply_to_message;
      if (!replyMsg?.document) {
        return sendTg(botToken, chatId, '❌ Reply to a .txt file with /filter to check each site.');
      }

      await sendTg(botToken, chatId, '🔍 Downloading file and checking sites...');

      const fileContent = await downloadTgFile(botToken, replyMsg.document.file_id);
      const lines = fileContent.split('\n').filter(l => l.trim() && !l.startsWith('#'));

      if (lines.length === 0) return sendTg(botToken, chatId, '❌ No URLs found in file.');

      // Extract URLs from each line
      const urls: string[] = [];
      for (const line of lines) {
        const url = line.split('|')[0].trim();
        if (url.startsWith('http')) urls.push(url);
      }

      if (urls.length === 0) return sendTg(botToken, chatId, '❌ No valid URLs found.');

      await sendTg(botToken, chatId, `🔄 Checking ${urls.length} sites for 2D/3D...\nThis may take a while.`);

      const results2d: string[] = [];
      const results3d: string[] = [];
      const resultsUnknown: string[] = [];
      let checked = 0;

      for (const url of urls) {
        try {
          const analysis = await analyzeSiteUrl(url);
          const line = `${url} | ${analysis.gateway} | ${analysis.gateType} | ${analysis.domain}${analysis.stripePk ? ` | pk:${analysis.stripePk}` : ''}`;

          if (analysis.gateType === '2d') results2d.push(line);
          else if (analysis.gateType === '3d') results3d.push(line);
          else resultsUnknown.push(line);

          checked++;

          // Progress update every 5 sites
          if (checked % 5 === 0) {
            await sendTg(botToken, chatId, `⏳ Checked ${checked}/${urls.length}... (2D: ${results2d.length} | 3D: ${results3d.length})`);
          }
        } catch (e) {
          resultsUnknown.push(`${url} | error | ${e instanceof Error ? e.message : 'unknown'}`);
          checked++;
        }
      }

      // Build results file
      let resultTxt = `# Filter Results — ${new Date().toISOString()}\n`;
      resultTxt += `# Checked: ${checked} | 2D: ${results2d.length} | 3D: ${results3d.length} | Unknown: ${resultsUnknown.length}\n\n`;

      if (results2d.length > 0) {
        resultTxt += `=== ✅ 2D GATES (${results2d.length}) ===\n`;
        resultTxt += results2d.join('\n') + '\n\n';
      }

      if (results3d.length > 0) {
        resultTxt += `=== 🔐 3D GATES (${results3d.length}) ===\n`;
        resultTxt += results3d.join('\n') + '\n\n';
      }

      if (resultsUnknown.length > 0) {
        resultTxt += `=== ❓ UNKNOWN (${resultsUnknown.length}) ===\n`;
        resultTxt += resultsUnknown.join('\n') + '\n\n';
      }

      const caption = `✅ <b>Filter Complete</b>\n\n` +
        `🟢 2D: ${results2d.length}\n` +
        `🔴 3D: ${results3d.length}\n` +
        `❓ Unknown: ${resultsUnknown.length}`;

      return sendTgDocument(botToken, chatId, `filtered_${Date.now()}.txt`, resultTxt, caption);
    }

    case 'cats': {
      const { data: cats } = await supabase.from('scraper_categories').select('*').order('name');
      if (!cats?.length) return sendTg(botToken, chatId, '📭 No categories.');
      let catMsg = `📂 <b>Categories</b>\n\n`;
      for (const c of cats) {
        catMsg += `${c.is_active ? '🟢' : '🔴'} <b>${c.name}</b>\n`;
        catMsg += `   Queries: ${c.search_queries.join(', ')}\n\n`;
      }
      return sendTg(botToken, chatId, catMsg);
    }

    case 'addcat': {
      if (!isOwner) return sendTg(botToken, chatId, '⛔ Owner only.');
      const rest = parts.slice(1).join(' ');
      const [name, queriesStr] = rest.split('|').map(s => s.trim());
      if (!name || !queriesStr) return sendTg(botToken, chatId, '❌ Usage: /addcat Name | query1, query2');
      const queries = queriesStr.split(',').map(q => q.trim()).filter(Boolean);
      const { error } = await supabase.from('scraper_categories').insert({ name, search_queries: queries, is_active: true });
      if (error) return sendTg(botToken, chatId, `❌ ${error.message}`);
      return sendTg(botToken, chatId, `✅ Added "<b>${name}</b>" with ${queries.length} queries.`);
    }

    case 'rmcat': {
      if (!isOwner) return sendTg(botToken, chatId, '⛔ Owner only.');
      const name = parts.slice(1).join(' ').trim();
      if (!name) return sendTg(botToken, chatId, '❌ Usage: /rmcat Category Name');
      const { error } = await supabase.from('scraper_categories').delete().ilike('name', `%${name}%`);
      if (error) return sendTg(botToken, chatId, `❌ ${error.message}`);
      return sendTg(botToken, chatId, `🗑 Removed "<b>${name}</b>".`);
    }

    case 'purge': {
      if (!isOwner) return sendTg(botToken, chatId, '⛔ Owner only.');
      const { count } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true });
      await supabase.from('scraped_sites').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      return sendTg(botToken, chatId, `🗑 Purged ${count || 0} sites.`);
    }

    case 'stats': {
      const { count: total } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true });
      const { count: stripe } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).eq('payment_gateway', 'stripe');
      const { count: adyen } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).eq('payment_gateway', 'adyen');
      const { count: confirmed } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).eq('status', 'confirmed');
      const { count: cats } = await supabase.from('scraper_categories').select('*', { count: 'exact', head: true }).eq('is_active', true);
      const { count: gate2d } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).contains('gateway_details', { gateType: '2d' });
      const { count: gate3d } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).contains('gateway_details', { gateType: '3d' });

      return sendTg(botToken, chatId,
        `📊 <b>Stats</b>\n\n` +
        `📦 Total: ${total || 0}\n` +
        `💳 Stripe: ${stripe || 0}\n` +
        `🔷 Adyen: ${adyen || 0}\n` +
        `✅ Confirmed: ${confirmed || 0}\n` +
        `🟢 2D Gates: ${gate2d || 0}\n` +
        `🔴 3D Gates: ${gate3d || 0}\n` +
        `📂 Categories: ${cats || 0}`);
    }

    default:
      return sendTg(botToken, chatId, `❓ Unknown command. /help`);
  }
}
