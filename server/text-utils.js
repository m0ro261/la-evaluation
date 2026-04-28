const ENTITIES = {
  // structural / punctuation
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&apos;': "'",
  '&hellip;': '…', '&ndash;': '–', '&mdash;': '—',
  '&lsquo;': '‘', '&rsquo;': '’',
  '&ldquo;': '“', '&rdquo;': '”',
  '&laquo;': '«', '&raquo;': '»', '&middot;': '·',
  '&copy;': '©', '&reg;': '®', '&trade;': '™', '&euro;': '€',
  // Latin-1 vowels with acute accent
  '&aacute;': 'á', '&Aacute;': 'Á',
  '&eacute;': 'é', '&Eacute;': 'É',
  '&iacute;': 'í', '&Iacute;': 'Í',
  '&oacute;': 'ó', '&Oacute;': 'Ó',
  '&uacute;': 'ú', '&Uacute;': 'Ú',
  '&yacute;': 'ý', '&Yacute;': 'Ý',
  // acute on consonants (Slovak)
  '&lacute;': 'ĺ', '&Lacute;': 'Ĺ',
  '&racute;': 'ŕ', '&Racute;': 'Ŕ',
  // caron / haček (Slovak + Czech)
  '&ccaron;': 'č', '&Ccaron;': 'Č',
  '&dcaron;': 'ď', '&Dcaron;': 'Ď',
  '&ecaron;': 'ě', '&Ecaron;': 'Ě',
  '&lcaron;': 'ľ', '&Lcaron;': 'Ľ',
  '&ncaron;': 'ň', '&Ncaron;': 'Ň',
  '&rcaron;': 'ř', '&Rcaron;': 'Ř',
  '&scaron;': 'š', '&Scaron;': 'Š',
  '&tcaron;': 'ť', '&Tcaron;': 'Ť',
  '&zcaron;': 'ž', '&Zcaron;': 'Ž',
  // circumflex
  '&ocirc;': 'ô', '&Ocirc;': 'Ô',
  '&acirc;': 'â', '&Acirc;': 'Â',
  '&ecirc;': 'ê', '&Ecirc;': 'Ê',
  '&icirc;': 'î', '&Icirc;': 'Î',
  '&ucirc;': 'û', '&Ucirc;': 'Û',
  // umlaut / diaeresis
  '&auml;': 'ä', '&Auml;': 'Ä',
  '&euml;': 'ë', '&Euml;': 'Ë',
  '&iuml;': 'ï', '&Iuml;': 'Ï',
  '&ouml;': 'ö', '&Ouml;': 'Ö',
  '&uuml;': 'ü', '&Uuml;': 'Ü',
  // grave
  '&agrave;': 'à', '&Agrave;': 'À',
  '&egrave;': 'è', '&Egrave;': 'È',
  '&igrave;': 'ì', '&Igrave;': 'Ì',
  '&ograve;': 'ò', '&Ograve;': 'Ò',
  '&ugrave;': 'ù', '&Ugrave;': 'Ù',
  // tilde / cedilla / other
  '&ntilde;': 'ñ', '&Ntilde;': 'Ñ',
  '&ccedil;': 'ç', '&Ccedil;': 'Ç',
  '&szlig;': 'ß',
  '&aring;': 'å', '&Aring;': 'Å',
};

import fs from 'node:fs/promises';

export function stripHtml(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  // Numeric entities (decimal and hex)
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; }
  });
  s = s.replace(/&#(\d+);/g, (_, d) => {
    try { return String.fromCodePoint(Number(d)); } catch { return ' '; }
  });
  // Named entities — known map. Unknown named entities collapse to a space
  // (so they don't survive as bogus tokens like "iacute", "foo", etc.)
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]{0,30});/g, (m) => ENTITIES[m] ?? ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const PREFIX_RE = /^(?:\s*(?:re|fwd?|odp\.?|fw)[:\s.]+)+/i;

export function stripSubjectPrefix(subject) {
  if (!subject) return '';
  let prev;
  let s = String(subject);
  do {
    prev = s;
    s = s.replace(PREFIX_RE, '').trim();
  } while (s !== prev);
  return s;
}

// Patterns that mark the start of a typical email signature/closing block.
// Once we find any of these, we cut off the text — the rest is signature
// and would otherwise pollute keyword extraction with brand/contact words.
const SIGNATURE_DELIMITERS = [
  /^\s*--\s*$/m,
  /\bS\s+priate(?:ľ|l)sk(?:ým|ymi)?\s+pozdravom\b/i,
  /\bS\s+pozdravom\b/i,
  /\b(?:Best|Kind|Warm|Sincere)\s+regards\b/i,
  /\bMany\s+thanks\b/i,
  /\bĎakujem\s*(?:za\s+(?:info|odpove(?:ď|d)|pomoc))?\s*[,.!]?\s*$/im,
  /\bV(?:ď|d)aka\s*[,.!]?\s*$/im,
  /\bPekn(?:ý|y)\s+de(?:ň|n)\b/i,
  /^[ \t]*(?:Mgr|Ing|JUDr|MUDr|RNDr|PhDr|Bc)\.\s+[A-ZČĎĹĽŇÔŔŠŤÚÝŽ]/m,
];

export function stripSignature(text) {
  if (!text) return '';
  const s = String(text);
  let cut = s.length;
  for (const re of SIGNATURE_DELIMITERS) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  return s.slice(0, cut).trim();
}

export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 30 && !/^\d+$/.test(t));
}

export async function loadStopwords(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return new Set(JSON.parse(raw).map(s => s.toLowerCase()));
}
