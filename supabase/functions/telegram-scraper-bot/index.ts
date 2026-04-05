import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

Deno.serve(async () => {
  const startTime = Date.now();

  const botToken = Deno.env.get('SCRAPER_TG_BOT_TOKEN');
  const adminChatId = Deno.env.get('SCRAPER_TG_CHAT_ID');
  if (!botToken || !adminChatId) {
    return new Response(JSON.stringify({ error: 'Missing SCRAPER_TG_BOT_TOKEN or SCRAPER_TG_CHAT_ID' }), { status: 500 });
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
      if (!msg?.text) continue;

      const chatId = msg.chat.id;
      const text = msg.text.trim();
      const isAdmin = String(chatId) === String(adminChatId);

      if (!isAdmin) {
        await sendTg(botToken, chatId, '⛔ Unauthorized.');
        continue;
      }

      try {
        await handleCommand(supabase, supabaseUrl, supabaseKey, botToken, chatId, text);
      } catch (e) {
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

// ── Command handler ──
async function handleCommand(supabase: any, supabaseUrl: string, supabaseKey: string, botToken: string, chatId: number, text: string) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/^\//, '');

  switch (cmd) {
    case 'start':
    case 'help':
      return sendTg(botToken, chatId, `🤖 <b>Scraper Bot</b>\n\n` +
        `/scrape — Run scraper (all categories)\n` +
        `/scrape [name] — Run for specific category\n` +
        `/sites — List discovered sites\n` +
        `/sites 2d — Show only 2D gates\n` +
        `/sites 3d — Show only 3D gates\n` +
        `/sites stripe — Stripe sites only\n` +
        `/cats — List categories\n` +
        `/addcat Name | query1, query2 — Add category\n` +
        `/rmcat Name — Remove category\n` +
        `/stats — Scraper statistics`);

    case 'scrape': {
      const catName = parts.slice(1).join(' ').trim();
      await sendTg(botToken, chatId, `🔄 Starting scrape${catName ? ` for "${catName}"` : ' (all categories)'}...`);

      let body: any = {};
      if (catName) {
        const { data: cat } = await supabase.from('scraper_categories').select('id').ilike('name', `%${catName}%`).maybeSingle();
        if (cat) body.category_id = cat.id;
        else return sendTg(botToken, chatId, `❌ Category "${catName}" not found.`);
      }

      const fnResp = await fetch(`${supabaseUrl}/functions/v1/site-scraper`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await fnResp.json();
      if (result.error) return sendTg(botToken, chatId, `❌ ${result.error}`);

      const r = result.results || {};
      return sendTg(botToken, chatId,
        `✅ <b>Scrape Complete</b>\n\n` +
        `🔍 Discovered: ${r.discovered || 0}\n` +
        `📊 Analyzed: ${r.analyzed || 0}\n` +
        `✅ Confirmed: ${r.confirmed || 0}\n` +
        `🟢 2D Gates: ${r.gates_2d || 0}\n` +
        `🔴 3D Gates: ${r.gates_3d || 0}\n` +
        `⏭ Skipped: ${r.skipped || 0}\n` +
        `❌ Errors: ${r.errors || 0}`);
    }

    case 'sites': {
      const filter = parts[1]?.toLowerCase();
      let query = supabase.from('scraped_sites').select('url,domain,payment_gateway,status,gateway_details,stripe_pk').order('created_at', { ascending: false }).limit(20);

      if (filter === '2d') query = query.contains('gateway_details', { gateType: '2d' });
      else if (filter === '3d') query = query.contains('gateway_details', { gateType: '3d' });
      else if (filter === 'stripe') query = query.eq('payment_gateway', 'stripe');
      else if (filter === 'adyen') query = query.eq('payment_gateway', 'adyen');
      else if (filter === 'confirmed') query = query.eq('status', 'confirmed');

      const { data: sites } = await query;
      if (!sites || sites.length === 0) return sendTg(botToken, chatId, '📭 No sites found.');

      let msg = `📋 <b>Sites</b> (${sites.length})${filter ? ` [${filter}]` : ''}\n\n`;
      for (const s of sites) {
        const gw = s.payment_gateway === 'stripe' ? '💳' : s.payment_gateway === 'adyen' ? '🔷' : '❓';
        const gate = s.gateway_details?.gateType === '2d' ? '✅2D' : s.gateway_details?.gateType === '3d' ? '🔐3D' : '❓';
        msg += `${gw} ${gate} <b>${s.domain}</b>\n<code>${s.url}</code>\n`;
        if (s.stripe_pk) msg += `🔑 <code>${s.stripe_pk.slice(0, 25)}...</code>\n`;
        msg += `\n`;
      }
      return sendTg(botToken, chatId, msg);
    }

    case 'cats': {
      const { data: cats } = await supabase.from('scraper_categories').select('*').order('name');
      if (!cats || cats.length === 0) return sendTg(botToken, chatId, '📭 No categories.');
      let msg = `📂 <b>Categories</b>\n\n`;
      for (const c of cats) {
        msg += `${c.is_active ? '🟢' : '🔴'} <b>${c.name}</b>\n`;
        msg += `   Queries: ${c.search_queries.join(', ')}\n\n`;
      }
      return sendTg(botToken, chatId, msg);
    }

    case 'addcat': {
      const rest = parts.slice(1).join(' ');
      const [name, queriesStr] = rest.split('|').map(s => s.trim());
      if (!name || !queriesStr) return sendTg(botToken, chatId, '❌ Usage: /addcat Name | query1, query2');
      const queries = queriesStr.split(',').map(q => q.trim()).filter(Boolean);

      const { error } = await supabase.from('scraper_categories').insert({ name, search_queries: queries, is_active: true });
      if (error) return sendTg(botToken, chatId, `❌ ${error.message}`);
      return sendTg(botToken, chatId, `✅ Added category "<b>${name}</b>" with ${queries.length} queries.`);
    }

    case 'rmcat': {
      const name = parts.slice(1).join(' ').trim();
      if (!name) return sendTg(botToken, chatId, '❌ Usage: /rmcat Category Name');
      const { error } = await supabase.from('scraper_categories').delete().ilike('name', `%${name}%`);
      if (error) return sendTg(botToken, chatId, `❌ ${error.message}`);
      return sendTg(botToken, chatId, `🗑 Removed category matching "<b>${name}</b>".`);
    }

    case 'stats': {
      const { count: total } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true });
      const { count: stripe } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).eq('payment_gateway', 'stripe');
      const { count: adyen } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).eq('payment_gateway', 'adyen');
      const { count: confirmed } = await supabase.from('scraped_sites').select('*', { count: 'exact', head: true }).eq('status', 'confirmed');
      const { count: cats } = await supabase.from('scraper_categories').select('*', { count: 'exact', head: true }).eq('is_active', true);

      return sendTg(botToken, chatId,
        `📊 <b>Scraper Stats</b>\n\n` +
        `📦 Total sites: ${total || 0}\n` +
        `💳 Stripe: ${stripe || 0}\n` +
        `🔷 Adyen: ${adyen || 0}\n` +
        `✅ Confirmed: ${confirmed || 0}\n` +
        `📂 Active categories: ${cats || 0}`);
    }

    default:
      return sendTg(botToken, chatId, `❓ Unknown command. Type /help for available commands.`);
  }
}

async function sendTg(token: string, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}
