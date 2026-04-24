// ============================================================
//  Combo Cleaner / Editor — pure utility functions.
//  Parsing, filtering, dedup, and provider classification for
//  email:password combos. No side effects — easy to unit test.
// ============================================================

const COMBO_RE = /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}):([^\s,;|]{1,256})/;

export type Combo = { email: string; pass: string; domain: string };

// Microsoft-family domains. Anything ending here = MS account.
export const MS_DOMAINS = [
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "hotmail.co.uk", "hotmail.fr", "hotmail.es", "hotmail.it",
  "hotmail.de", "outlook.fr", "outlook.es", "outlook.de",
  "outlook.it", "live.fr", "live.com.mx", "live.co.uk",
  "passport.com", "windowslive.com",
];

export const GOOGLE_DOMAINS = ["gmail.com", "googlemail.com"];
export const YAHOO_DOMAINS = ["yahoo.com", "yahoo.co.uk", "yahoo.fr", "ymail.com", "rocketmail.com"];
export const APPLE_DOMAINS = ["icloud.com", "me.com", "mac.com"];
export const AOL_DOMAINS = ["aol.com", "aim.com"];
export const PROTON_DOMAINS = ["protonmail.com", "proton.me", "pm.me"];

export function parseLine(raw: string): Combo | null {
  const m = raw.match(COMBO_RE);
  if (!m) return null;
  const email = m[1].trim().toLowerCase();
  const pass = m[2].trim();
  if (!email || !pass) return null;
  const domain = email.split("@")[1] || "";
  return { email, pass, domain };
}

export function parseAll(text: string): Combo[] {
  if (!text) return [];
  const out: Combo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = parseLine(line);
    if (c) out.push(c);
  }
  return out;
}

export function dedupe(combos: Combo[]): Combo[] {
  const seen = new Set<string>();
  const out: Combo[] = [];
  for (const c of combos) {
    const k = `${c.email}:${c.pass}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export function dedupeByEmail(combos: Combo[]): Combo[] {
  const seen = new Set<string>();
  const out: Combo[] = [];
  for (const c of combos) {
    if (seen.has(c.email)) continue;
    seen.add(c.email);
    out.push(c);
  }
  return out;
}

export function filterByDomains(combos: Combo[], domains: string[]): Combo[] {
  const set = new Set(domains.map((d) => d.toLowerCase()));
  return combos.filter((c) => set.has(c.domain));
}

export function excludeDomains(combos: Combo[], domains: string[]): Combo[] {
  const set = new Set(domains.map((d) => d.toLowerCase()));
  return combos.filter((c) => !set.has(c.domain));
}

export function filterByPasswordLength(combos: Combo[], min: number, max: number): Combo[] {
  return combos.filter((c) => c.pass.length >= min && c.pass.length <= max);
}

export function removeNumericOnlyPasswords(combos: Combo[]): Combo[] {
  return combos.filter((c) => !/^\d+$/.test(c.pass));
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function toText(combos: Combo[]): string {
  return combos.map((c) => `${c.email}:${c.pass}`).join("\n");
}

export type ProviderKey = "microsoft" | "google" | "yahoo" | "apple" | "aol" | "proton" | "other";

export function classify(combo: Combo): ProviderKey {
  const d = combo.domain;
  if (MS_DOMAINS.includes(d)) return "microsoft";
  if (GOOGLE_DOMAINS.includes(d)) return "google";
  if (YAHOO_DOMAINS.includes(d)) return "yahoo";
  if (APPLE_DOMAINS.includes(d)) return "apple";
  if (AOL_DOMAINS.includes(d)) return "aol";
  if (PROTON_DOMAINS.includes(d)) return "proton";
  return "other";
}

export function groupByProvider(combos: Combo[]): Record<ProviderKey, Combo[]> {
  const groups: Record<ProviderKey, Combo[]> = {
    microsoft: [], google: [], yahoo: [], apple: [], aol: [], proton: [], other: [],
  };
  for (const c of combos) groups[classify(c)].push(c);
  return groups;
}

export function groupByDomain(combos: Combo[]): Record<string, Combo[]> {
  const out: Record<string, Combo[]> = {};
  for (const c of combos) {
    if (!out[c.domain]) out[c.domain] = [];
    out[c.domain].push(c);
  }
  return out;
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadZip(files: { name: string; content: string }[], zipName: string) {
  // Tiny inline ZIP (no external dep). Uses STORE method (no compression).
  const encoder = new TextEncoder();
  const fileData: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (data: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const content = encoder.encode(f.content);
    const crc = crc32(content);
    const size = content.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const dvL = new DataView(local.buffer);
    dvL.setUint32(0, 0x04034b50, true);
    dvL.setUint16(4, 20, true); dvL.setUint16(6, 0, true); dvL.setUint16(8, 0, true);
    dvL.setUint16(10, 0, true); dvL.setUint16(12, 0, true);
    dvL.setUint32(14, crc, true); dvL.setUint32(18, size, true); dvL.setUint32(22, size, true);
    dvL.setUint16(26, nameBytes.length, true); dvL.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const dvC = new DataView(cd.buffer);
    dvC.setUint32(0, 0x02014b50, true);
    dvC.setUint16(4, 20, true); dvC.setUint16(6, 20, true); dvC.setUint16(8, 0, true);
    dvC.setUint16(10, 0, true); dvC.setUint16(12, 0, true); dvC.setUint16(14, 0, true);
    dvC.setUint32(16, crc, true); dvC.setUint32(20, size, true); dvC.setUint32(24, size, true);
    dvC.setUint16(28, nameBytes.length, true); dvC.setUint16(30, 0, true);
    dvC.setUint16(32, 0, true); dvC.setUint16(34, 0, true); dvC.setUint16(36, 0, true);
    dvC.setUint32(38, 0, true); dvC.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    fileData.push(local, content);
    central.push(cd);
    offset += local.length + content.length;
  }

  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = new Uint8Array(22);
  const dvE = new DataView(end.buffer);
  dvE.setUint32(0, 0x06054b50, true);
  dvE.setUint16(4, 0, true); dvE.setUint16(6, 0, true);
  dvE.setUint16(8, files.length, true); dvE.setUint16(10, files.length, true);
  dvE.setUint32(12, centralSize, true); dvE.setUint32(16, offset, true);
  dvE.setUint16(20, 0, true);

  const blob = new Blob([...fileData, ...central, end], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = zipName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
