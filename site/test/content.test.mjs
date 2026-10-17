import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
test('honest static introduction, real source CTA and local-only assets', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const id of ['workflow', 'workspace', 'direction', 'questions']) assert.match(html, new RegExp(`id="${id}"`));
  for (const text of ['Claude Code', 'Codex', 'Linux', 'Node.js 20.9+', 'licensing is being finalized', 'not a live product session', 'may send code']) assert.ok(html.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(html, /href="https:\/\/github.com\/dmitry-yudakov\/code-vis#readme"/);
  assert.doesNotMatch(html, /<form|<iframe|<img[^>]+src="https?:|<script[^>]+src="https?:|<link[^>]+href="https?:/i);
  for (const href of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${href[1]}"`), href[0]);
});
test('all referenced assets exist; no provider, storage or telemetry plumbing', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    if (match[1].startsWith('https://')) {
      assert.match(match[1], /^https:\/\/github.com\/dmitry-yudakov\/code-vis(?:#readme)?$/);
    } else await readFile(new URL(match[1], root));
  }
  const js = await readFile(new URL('workflow.js', root), 'utf8');
  const css = await readFile(new URL('style.css', root), 'utf8');
  assert.doesNotMatch(js, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|https?:/);
  assert.doesNotMatch(css, /@import|url\s*\(/i);
  assert.match(html, /connect-src 'none'/);
});
