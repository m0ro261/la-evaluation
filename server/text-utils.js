const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&apos;': "'", '&#39;': "'",
};

import fs from 'node:fs/promises';

export function stripHtml(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&[a-z#0-9]+;/gi, m => ENTITIES[m] ?? (m.startsWith('&#') ? String.fromCodePoint(Number(m.slice(2, -1))) : m));
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
