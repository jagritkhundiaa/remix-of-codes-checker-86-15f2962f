// ============================================================
//  Supabase helper — save pulled codes to promos_unchecked
// ============================================================

const config = require("../config");

/**
 * Save an array of codes to promos_unchecked table.
 * @param {Array<{code: string, status?: string, title?: string}>} codes
 * @param {string} pulledBy - Discord username
 * @param {string} discordUserId - Discord user ID
 * @param {string} sourceEmail - Email the codes were fetched from (optional)
 */
async function savePromosUnchecked(codes, { pulledBy, discordUserId, sourceEmail } = {}) {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY || config.SUPABASE_SERVICE_KEY === "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE") {
    console.log("[Supabase] Skipping save — no service key configured");
    return { saved: 0, error: null };
  }

  if (!codes || codes.length === 0) return { saved: 0, error: null };

  const rows = codes.map((c) => ({
    code: typeof c === "string" ? c : c.code,
    title: typeof c === "string" ? null : (c.title || null),
    status: typeof c === "string" ? null : (c.status || null),
    source_email: sourceEmail || null,
    pulled_by: pulledBy || null,
    discord_user_id: discordUserId || null,
  }));

  try {
    // Batch insert in chunks of 500
    const CHUNK = 500;
    let totalSaved = 0;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const res = await fetch(`${config.SUPABASE_URL}/rest/v1/promos_unchecked`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${config.SUPABASE_SERVICE_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Supabase] Insert error (chunk ${i / CHUNK + 1}):`, errText);
        return { saved: totalSaved, error: errText };
      }
      totalSaved += chunk.length;
    }

    console.log(`[Supabase] Saved ${totalSaved} codes to promos_unchecked`);
    return { saved: totalSaved, error: null };
  } catch (err) {
    console.error("[Supabase] Save error:", err.message);
    return { saved: 0, error: err.message };
  }
}

module.exports = { savePromosUnchecked };
