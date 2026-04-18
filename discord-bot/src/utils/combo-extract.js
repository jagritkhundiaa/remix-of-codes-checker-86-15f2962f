// ============================================================
//  Combo Extractor — pulls clean email:password pairs from
//  noisy text/files (URLs, ULP captures, mixed garbage).
//  Returns up to `limit` valid pairs and silently skips junk.
// ============================================================

// email:password — email part is permissive (most providers),
// password is non-whitespace, length >= 1, captured greedily up
// to next whitespace, comma, semicolon, or pipe.
const COMBO_RE = /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}):([^\s,;|]{1,256})/g;

/**
 * Extract email:password pairs from raw text, deduplicated, capped at limit.
 * Accepts ULP-style lines like "https://site|user@x.com:pw" — we just grab the combo.
 */
function extractCombos(raw, limit = Infinity) {
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  let match;
  COMBO_RE.lastIndex = 0;
  while ((match = COMBO_RE.exec(raw)) !== null) {
    const email = match[1].trim();
    const pw = match[2].trim();
    if (!email || !pw) continue;
    const combo = `${email}:${pw}`;
    if (seen.has(combo)) continue;
    seen.add(combo);
    out.push(combo);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { extractCombos };
