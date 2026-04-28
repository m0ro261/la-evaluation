import test from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml } from './text-utils.js';

test('stripHtml removes tags and collapses whitespace', () => {
  const input = '<div>Dobrý  <b>deň</b><br>chcem  sa<br/>pýtať</div>';
  assert.equal(stripHtml(input), 'Dobrý deň chcem sa pýtať');
});

test('stripHtml decodes common entities', () => {
  assert.equal(stripHtml('a&nbsp;b&amp;c &lt;x&gt; &#39;y&#39; &quot;z&quot;'), 'a b&c <x> \'y\' "z"');
});

test('stripHtml decodes Slovak/Latin diacritic entities', () => {
  assert.equal(stripHtml('Z&aacute;kazn&iacute;cka podpora'), 'Zákaznícka podpora');
  assert.equal(stripHtml('m&ocirc;&zcaron;e bra&tcaron;'), 'môže brať');
  assert.equal(stripHtml('&Iacute;NG. N&aacute;rodn&yacute;'), 'ÍNG. Národný');
});

test('stripHtml decodes hex numeric entities', () => {
  // 'í' = U+00ED = &#xed;
  assert.equal(stripHtml('Pr&#xed;klad'), 'Príklad');
  // decimal too: 'á' = 225
  assert.equal(stripHtml('p&#225;r'), 'pár');
});

test('stripHtml replaces unknown named entities with whitespace', () => {
  // unknown entity should NOT survive as a token like "iacute"
  assert.equal(stripHtml('foo&unknownentity;bar'), 'foo bar');
});

test('stripHtml handles empty/null gracefully', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('stripHtml strips style and script blocks', () => {
  assert.equal(stripHtml('a<style>.x{}</style>b<script>alert(1)</script>c'), 'a b c');
});

import { stripSubjectPrefix, tokenize, loadStopwords, stripSignature } from './text-utils.js';
import path from 'node:path';

test('stripSignature cuts at S priateľským pozdravom', () => {
  const body = 'Dobrý deň, mám otázku ohľadom produktu.\n\nS priateľským pozdravom\nIng. Ján Novák\nXY s.r.o.';
  assert.equal(stripSignature(body), 'Dobrý deň, mám otázku ohľadom produktu.');
});

test('stripSignature cuts at Best regards', () => {
  const body = 'Hello, please help.\n\nBest regards\nJohn';
  assert.equal(stripSignature(body), 'Hello, please help.');
});

test('stripSignature cuts at standalone "--" email separator', () => {
  const body = 'Question text here.\n--\nJohn Doe\njohn@example.com';
  assert.equal(stripSignature(body), 'Question text here.');
});

test('stripSignature returns input unchanged when no signature found', () => {
  const body = 'Just a question, no signature.';
  assert.equal(stripSignature(body), 'Just a question, no signature.');
});

test('stripSignature removes URLs, ticket codes, emails, dates as noise', () => {
  const body = 'Visit https://creativesites.sk/admin and order MNQ-QKSRK-311 from peter@x.sk on 28.4.2026.';
  const out = stripSignature(body);
  assert.ok(!/https?:\/\//.test(out), `URL leaked: ${out}`);
  assert.ok(!/MNQ-QKSRK-311/.test(out), `ticket code leaked: ${out}`);
  assert.ok(!/peter@x\.sk/.test(out), `email leaked: ${out}`);
  assert.ok(!/28\.4\.2026/.test(out), `date leaked: ${out}`);
  assert.match(out, /Visit\s+and order\s+from\s+on/);
});

test('stripSignature cuts at quoted reply markers', () => {
  // "Dňa <date>" reply marker
  const body1 = 'Mám otázku ohľadom produktu.\n\nDňa 28.4.2026 napísal Peter:\n> predošlá odpoveď';
  assert.equal(stripSignature(body1), 'Mám otázku ohľadom produktu.');
  // English "On <date> ... wrote:" reply marker
  const body2 = 'I have a question.\n\nOn Mon, Apr 28, 2026 at 10:00 AM, Peter <peter@x.sk> wrote:\n> previous';
  assert.match(stripSignature(body2), /^I have a question\.$/);
  // Outlook header pattern
  const body3 = 'Test message.\nFrom: Peter\nSent: Monday\n> ...';
  assert.equal(stripSignature(body3), 'Test message.');
});

test('stripSubjectPrefix removes Re:/Fwd:/Fw:/Odp: chains', () => {
  assert.equal(stripSubjectPrefix('Re: Re: Fwd: Hello'), 'Hello');
  assert.equal(stripSubjectPrefix('FW:    Production down'), 'Production down');
  assert.equal(stripSubjectPrefix('Odp: Odp.: re: chyba'), 'chyba');
  assert.equal(stripSubjectPrefix('Bez prefixu'), 'Bez prefixu');
});

test('tokenize lowercases, splits, drops short and numeric', () => {
  const tokens = tokenize('Dobrý deň, problém s eshopom 12345 ABC.');
  assert.deepEqual(tokens, ['dobrý', 'deň', 'problém', 'eshopom', 'abc']);
});

test('tokenize keeps slovak diacritics intact', () => {
  assert.deepEqual(tokenize('žltý kôň ľúbi'), ['žltý', 'kôň', 'ľúbi']);
});

test('loadStopwords reads JSON list and returns a Set', async () => {
  const set = await loadStopwords(path.resolve('data/stopwords-sk.json'));
  assert.ok(set instanceof Set);
  assert.ok(set.has('a'));
  assert.ok(set.has('re'));
  assert.ok(!set.has('eshop'));
});
