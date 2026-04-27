const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&apos;': "'", '&#39;': "'",
};

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
