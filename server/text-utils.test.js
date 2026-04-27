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
