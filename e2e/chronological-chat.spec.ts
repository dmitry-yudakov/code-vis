import { expect, test, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function openSession(page: Page, request: APIRequestContext, theme: 'light' | 'dark', instruction: string | null = '[chronological-ui] Inspect chat activity.') {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find(item => item.relativePath === 'alpha')!;
  const project = (await (await request.post('/api/projects', { data: { name: `Chronological UI ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const session = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: /^Agent/ }).click();
  if (instruction !== null) {
    await conversation.getByRole('textbox', { name: 'Instruction', exact: true }).fill(instruction);
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  }
  return { conversation, session };
}

async function textContrast(nodes: Locator) {
  return nodes.evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (fore: number[], back: number[]) => fore.slice(0, 3).map((value, index) => value * fore[3] / 255 + back[index] * (1 - fore[3] / 255));
    const ancestors: Element[] = []; for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const ancestor of ancestors) background = over(rgba(getComputedStyle(ancestor).backgroundColor), background);
    const foreground = over(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const a = luminance(foreground), b = luminance(background);
    return { text: element.textContent?.slice(0, 70), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  }));
}
async function inViewport(target: Locator, page: Page) {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.afterEach(async ({ request }) => {
  const runs = await (await request.get('/api/agent/runs')).json();
  for (const run of runs.active ?? []) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: idle conversation controls and normal text contrast`, async ({ page, request }) => {
    const { conversation } = await openSession(page, request, theme, null);
    const controls = await conversation.locator('button:visible, select:visible, textarea:visible').count();
    const contrast = await textContrast(conversation.locator('header strong, .drawer-empty, .inline-status, .composer-menu > button'));
    await mkdir('test-results/chronological-chat', { recursive: true });
    await writeFile(`test-results/chronological-chat/${theme}-idle${process.env.CODEAI_METRICS_BASELINE ? '-baseline' : ''}.json`, JSON.stringify({ controls, contrast }, null, 2));
    for (const item of contrast) expect(item.ratio, item.text).toBeGreaterThanOrEqual(4.5);
    // The pre-story production baseline has nine visible controls, including its textarea.
    expect(controls).toBeLessThanOrEqual(9);
  });

  test(`${theme}: ordered durable tools, fixed approvals, review, drafts and scrolling`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { conversation, session } = await openSession(page, request, theme);
    const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
    await expect(field).toHaveValue('');
    await field.fill('My next draft');
    const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
    await expect(approvals).toContainText('1 of 2');
    const contrast = await textContrast(conversation.locator('.message-meta, .tool-summary, .tool-summary small, .activity-approval, .assistant-blocks p'));
    for (const item of contrast) expect(item.ratio, item.text).toBeGreaterThanOrEqual(4.5);
    await mkdir('test-results/chronological-chat', { recursive: true });
    await writeFile(`test-results/chronological-chat/${theme}-activity-contrast.json`, JSON.stringify(contrast, null, 2));
    await expect(field).toBeFocused();
    const rows = conversation.locator('[data-activity-id]');
    const ids = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-activity-id')));
    expect(new Set(ids).size).toBe(ids.length);
    const parallel = conversation.locator('.activity-tool').filter({ hasText: /first command|second command/ });
    expect(await parallel.allTextContents()).toEqual([expect.stringContaining('first command'), expect.stringContaining('second command')]);
    for (const width of [1440, 1000, 360]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      await inViewport(approvals.getByRole('button', { name: 'Allow once', exact: true }), page);
      await inViewport(approvals.getByRole('button', { name: 'Deny', exact: true }), page);
      await inViewport(conversation.getByRole('button', { name: 'Cancel', exact: true }), page);
      await inViewport(field, page);
      expect(await conversation.locator('.conversation-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-${width}-approval.png` });
    }
    await page.setViewportSize({ width: 1000, height: 800 });
    // Exercise the documented minimum conversation content width within a docked workspace.
    await conversation.evaluate(element => { (element as HTMLElement).style.width = '320px'; });
    await inViewport(approvals.getByRole('button', { name: 'Allow once', exact: true }), page);
    await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-320-approval.png` });
    await conversation.evaluate(element => { (element as HTMLElement).style.width = ''; });
    await approvals.getByRole('button', { name: 'Review', exact: true }).click();
    const review = page.getByRole('dialog', { name: /Review/ });
    await expect(review).toContainText('LAST REVIEW LINE');
    await review.locator('.MuiDialogContent-root').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await inViewport(review.getByRole('button', { name: 'Allow once', exact: true }), page);
    await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-review.png` });
    await review.getByRole('button', { name: 'Close', exact: true }).click();
    const scroll = conversation.locator('.conversation-scroll');
    await scroll.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
    await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(approvals).toContainText('1 of 1');
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
    await expect(conversation.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
    await approvals.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(approvals).toHaveCount(0);
    await expect(conversation).toContainText('Updated conversation.');
    await expect(conversation.locator('.activity-approval')).toContainText(['Denied', 'Allowed']);
    await expect(conversation.locator('.tool-error')).toContainText(['The action was denied.', 'Allowed action failed with exit 1.']);
    await expect(field).toHaveValue('My next draft');
    await conversation.getByRole('button', { name: /Jump to latest/ }).click();
    await expect(conversation.locator('.diagram-card')).toHaveCount(1);
    const before = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-activity-id')));
    await page.reload();
    await expect(conversation).toContainText('Updated conversation.');
    expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-activity-id')))).toEqual(before);
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect(saved.version).toBe(13);
    expect(saved.messages[0]).toMatchObject({ turn: { lifecycle: 'completed', history: 'saved' } });
    await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-completed.png` });
  });
}

test('unknown complete review blocks only desktop Allow, external decisions reconcile, and stale inline reviews do not open the next turn', async ({ page, request }) => {
  const { conversation, session } = await openSession(page, request, 'light', '[chronological-ui] unavailable review');
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals).toContainText('1 of 2');
  await expect(approvals.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await expect(approvals.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled();
  await expect(conversation.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await conversation.locator('.activity-approval').first().getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('dialog', { name: /Review/ });
  await expect(review).not.toContainText('OMITTED-FIXTURE-SECRET');
  await expect(review.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  const runs = await (await request.get(`/api/agent/runs?sessionId=${session.id}`)).json();
  const run = runs.active.find((item: { sessionId: string }) => item.sessionId === session.id);
  // Arena/Inbox/VR use this unchanged broker route, which has no desktop completeness gate.
  expect((await request.post('/api/agent/permission', { data: { runId: run.runId, requestId: run.pendingPermissions[0].requestId, decision: 'allow' } })).ok()).toBe(true);
  await expect(approvals).toContainText('1 of 1');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toHaveCount(0);
  await expect(conversation).toContainText('Updated conversation.');
  const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await field.fill('[chronological-ui] A new turn');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await field.focus();
  await expect(approvals).toContainText('1 of 2');
  await expect(review).toHaveCount(0);
  await expect(field).toBeFocused();
  await approvals.getByRole('button', { name: 'Next approval', exact: true }).click();
  await expect(approvals).toContainText('2 of 2');
  await expect(approvals).toContainText('false');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toContainText('1 of 1');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
});

test('a later approval in the same run waits for an explicit Review without stealing composer focus', async ({ page, request }) => {
  const { conversation } = await openSession(page, request, 'light', '[chronological-ui] sequential review');
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals).toContainText('1 of 2');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toContainText('1 of 1');
  const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await field.focus();
  const reviewButton = approvals.getByRole('button', { name: 'Review', exact: true });
  for (let i = 0; i < 12 && !await reviewButton.evaluate(element => element === document.activeElement); i++) await page.keyboard.press('Shift+Tab');
  await expect(reviewButton).toBeFocused();
  await page.keyboard.press('Enter');
  const review = page.getByRole('dialog', { name: /Review/ });
  const deny = review.getByRole('button', { name: 'Deny', exact: true });
  for (let i = 0; i < 8 && !await deny.evaluate(element => element === document.activeElement); i++) await page.keyboard.press('Tab');
  await expect(deny).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(approvals).toHaveCount(0);
  await field.fill('Next draft keeps focus');
  await expect(approvals).toContainText('true');
  await expect(review).toHaveCount(0);
  await expect(field).toBeFocused();
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
});
