import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { preview } from '../serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(resolve(process.env.PLAYWRIGHT_MODULE)) : require('@playwright/test');
const evidence = resolve(process.env.EVIDENCE_DIR || resolve(tmpdir(), 'codeai-landing-evidence'));
await mkdir(evidence, { recursive: true });
const fileMode = process.env.PREVIEW_MODE === 'file';
const server = fileMode ? null : preview(0);
if (server) await once(server, 'listening');
const origin = fileMode ? new URL('../index.html', import.meta.url).href : `http://127.0.0.1:${server.address().port}`;
const assetPrefix = fileMode ? new URL('.', origin).href : origin + '/';
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: name === 'mobile' });
    const page = await context.newPage();
    const errors = [], remote = [], bad = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) bad.push(r.url()); });
    await page.route('**/*', route => { if (!route.request().url().startsWith(assetPrefix)) { remote.push(route.request().url()); return route.abort(); } return route.continue(); });
    await page.goto(origin);
    assert.equal(await page.locator('#stage-controls').isVisible(), true, 'enhanced stage controls visible');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip').evaluate(el => el === document.activeElement), true);
    assert.notEqual(await page.locator('.skip').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '02 Explore' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button', { name: '02 Explore' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-content="explore"]').isVisible(), true);
    assert.equal(await page.locator('[data-content="discuss"]').isVisible(), false);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    assert.equal(await page.getByRole('button', { name: '03 Review' }).getAttribute('aria-pressed'), 'true');
    if (name === 'mobile') await page.getByRole('button', { name: '01 Discuss' }).tap();
    else await page.getByRole('button', { name: '01 Discuss' }).click();
    assert.equal(await page.locator('[data-content="discuss"]').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: '01 Discuss' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-content="review"]').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: '03 Review' }).getAttribute('aria-pressed'), 'false');
    await page.locator('summary').first().click();
    assert.equal(await page.locator('details').first().getAttribute('open'), '');
    await page.locator('summary').first().focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('details').first().getAttribute('open'), null);
    await page.getByRole('link', { name: 'Walk through the workflow' }).click();
    assert.equal(new URL(page.url()).hash, '#workflow');
    for (const link of await page.locator('a[href^="https:"]').all()) assert.match(await link.getAttribute('href'), /^https:\/\/github.com\/dmitry-yudakov\/code-vis(?:#readme)?$/);
    for (const control of await page.locator('button, summary, nav a, .button, .text-link').all()) {
      if (!(await control.isVisible())) continue; // Responsive navigation intentionally hides one redundant anchor.
      const box = await control.boundingBox(); assert.ok(box && box.height >= 44 && box.width >= 44, 'visible touch target at least 44px in both dimensions');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    await page.getByRole('button', { name: '01 Discuss' }).click();
    await page.goto(origin);
    await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(remote, []); assert.deepEqual(bad, []);
    await context.close();
    const plain = await browser.newContext({ viewport, javaScriptEnabled: false });
    const plainPage = await plain.newPage();
    await plainPage.goto(origin);
    for (const stage of ['discuss', 'explore', 'review']) assert.equal(await plainPage.locator(`[data-content="${stage}"]`).isVisible(), true);
    assert.equal(await plainPage.locator('#stage-controls').isVisible(), false);
    await plainPage.locator('summary').first().click();
    assert.equal(await plainPage.locator('details').first().getAttribute('open'), '');
    assert.equal(await plainPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await plainPage.locator('a[href$="#readme"]').first().isVisible(), true);
    await plain.close();
    console.log(`PASS ${name} ${viewport.width}x${viewport.height}: keyboard/workflow, FAQ, anchors, targets, overflow, reduced motion, no JS errors/non-local requests; JS-disabled content/FAQ. Screenshot: ${evidence}/${name}.png`);
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  console.log(server ? 'Temporary loopback preview stopped.' : 'File-mode check finished; no server started.');
}
