// ============================================================
//  Combo Extractor — pulls email:pass from dirty lines
//  - Accepts "url:email:pass", "email|pass", "anything email pass anything"
//  - Returns the first email:password pair found per line
// ============================================================

const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;

function extractCombo(line) {
  if (!line) return null;
  const raw = String(line).trim();
  if (!raw) return null;

  // Fast path: already email:password
  const directMatch = raw.match(/(^|[\s|;,])([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})[:|](\S+)/i);
  if (directMatch) {
    const email = directMatch[2].trim();
    const pass = directMatch[3].trim();
    if (email && pass) return `${email}:${pass}`;
  }

  // Find any email then look for the password after it (separated by : | ; , or whitespace)
  const emailMatch = raw.match(EMAIL_RE);
  if (!emailMatch) return null;
  const email = emailMatch[0];
  const after = raw.substring(emailMatch.index + email.length);
  // Strip leading separator characters
  const afterClean = after.replace(/^[\s:|;,\\/\-]+/, "");
  if (!afterClean) return null;
  // Password = until next whitespace / pipe / semicolon
  const passMatch = afterClean.match(/^([^\s|;]+)/);
  if (!passMatch) return null;
  return `${email}:${passMatch[1]}`;
}

/**
 * Normalize an array of raw lines into clean email:password combos.
 * - Skips lines that yield no extractable combo
 * - Caps to maxLines (skips remainder, no error)
 */
function extractCombos(lines, maxLines = 4000) {
  const out = [];
  for (const line of lines) {
    if (out.length >= maxLines) break;
    const combo = extractCombo(line);
    if (combo) out.push(combo);
  }
  return out;
}

module.exports = { extractCombo, extractCombos };
