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

test('stripHtml handles empty/null gracefully', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('stripHtml strips style and script blocks', () => {
  assert.equal(stripHtml('a<style>.x{}</style>b<script>alert(1)</script>c'), 'a b c');
});

import { stripSubjectPrefix, tokenize, loadStopwords } from './text-utils.js';
import path from 'node:path';

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
