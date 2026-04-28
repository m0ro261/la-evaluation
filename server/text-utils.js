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

// Patterns that mark the start of a typical email signature/closing OR a
// quoted reply block. Anything past the earliest match is dropped — we
// don't want signatures, contact details, or quoted prior agent replies
// polluting keyword extraction.
const SIGNATURE_DELIMITERS = [
  // Standalone email separator
  /^\s*--\s*$/m,
  // Slovak / Czech sign-offs
  /\bS\s+priate(?:ľ|l)sk(?:ým|ymi)?\s+pozdravom\b/i,
  /\bS\s+pozdravom\b/i,
  /\bPekn(?:ý|y)\s+de(?:ň|n)\b/i,
  /\bĎakujem\s*(?:za\s+(?:info|odpove(?:ď|d)|pomoc))?\s*[,.!]?\s*$/im,
  /\bV(?:ď|d)aka\s*[,.!]?\s*$/im,
  // English sign-offs
  /\b(?:Best|Kind|Warm|Sincere)\s+regards\b/i,
  /\bMany\s+thanks\b/i,
  // Title + name pattern (Mgr. Peter X, Ing. Ján Y, ...)
  /^[ \t]*(?:Mgr|Ing|JUDr|MUDr|RNDr|PhDr|Bc)\.\s+[A-ZČĎĹĽŇÔŔŠŤÚÝŽ]/m,
  // Quoted-reply markers (everything below is the prior conversation)
  /^\s*Dňa\s+\d/im,                      // "Dňa 28.4.2026 napísal X"
  /^\s*Dna\s+\d/im,                      // (no diacritics fallback)
  /\bP[ií]še\s+[A-ZČĎĹĽŇÔŔŠŤÚÝŽ]/u,      // "Píše Peter ..."
  /\bOn\s+[A-Z][a-z]{2},?\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}.{0,40}wrote:/i, // "On Mon, Apr 28, 2026 ... wrote:"
  /\bOn\s+\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}.{0,40}wrote:/i,
  /^-{2,}\s*Original\s+Message\s*-{2,}/im,
  /^-{2,}\s*P(?:ô|o)vodn(?:á|a)\s+spr(?:á|a)va\s*-{2,}/im,
  /^From:\s+.+\nSent:\s+/im,             // Outlook-style header
  /^From:\s+.+\nDate:\s+/im,             // mail.app-style header
  /\[mailto:[^\]]+\]/i,                  // "Peter [mailto:peter@x.sk]"
];

// Patterns to surgically REMOVE (replace with space) before signature cut.
// Unlike SIGNATURE_DELIMITERS these don't terminate the text — they just
// scrub specific noise that survives anywhere in the body.
const NOISE_PATTERNS = [
  /https?:\/\/\S+/gi,                    // URLs
  /\bwww\.\S+/gi,
  /\b[A-Z]{3}-[A-Z]{5}-\d{3,}\b/g,       // LA ticket codes (NMJ-QKSRK-311)
  /\b[A-Z0-9]{8,}\b/g,                   // long alphanumeric IDs (order numbers)
  /\b\d{6,}\b/g,                         // long numeric IDs
  /<[^>]+@[^>]+>/g,                      // email addresses in <foo@bar.sk>
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // bare email addresses
  /\+\d[\d\s()/-]{5,}/g,                 // phone numbers with leading +
  /\b\d{1,3}\.\d{1,3}\.\d{2,4}\b/g,      // dates 28.4.2026
];

export function stripSignature(text) {
  if (!text) return '';
  let s = String(text);
  // 1) Find earliest signature / quoted-reply cut FIRST. Some markers
  //    (e.g. "Dňa <date> napísal ...") rely on date tokens that the noise
  //    pass below would otherwise scrub away.
  let cut = s.length;
  for (const re of SIGNATURE_DELIMITERS) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  s = s.slice(0, cut);
  // 2) Now scrub the surviving text: URLs/codes/emails/dates would otherwise
  //    show up as top "rare" tokens with high G² but zero semantic meaning.
  for (const re of NOISE_PATTERNS) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
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
