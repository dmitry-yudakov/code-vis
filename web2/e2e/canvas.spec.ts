import { expect, test } from '@playwright/test';

test('creates, annotates, revises, restores, and exports a canvas conversation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your repository/ })).toBeVisible();
  await page.getByRole('button', { name: /alpha/ }).click();
  await expect(page.locator('.project-search-meta')).toContainText('3 projects');
  await expect(page.locator('.project-search-meta')).toContainText('Depth 2');
  const projectSearch = page.getByRole('searchbox', { name: 'Search projects' });
  await projectSearch.fill('not-a-project');
  await expect(page.locator('.project-search-empty')).toContainText('No projects match');
  await projectSearch.fill('DEEP');
  const projectResults = page.getByRole('listbox', { name: 'Projects' });
  await expect(projectResults.getByRole('option')).toHaveCount(1);
  await projectResults.getByRole('option', { name: /packages\/deep-app/ }).click();
  await expect(page.locator('.project-search-trigger')).toContainText('packages/deep-app');
  await page.getByRole('button', { name: /New conversation/ }).click();

  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toBeVisible();
  const openConversation = page.getByRole('button', { name: 'Open conversation' });

  const composer = page.getByPlaceholder(/Ask anything about this project/);
  await composer.fill('Draw a simple architecture');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.diagram-canvas-shell')).toBeVisible();
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await expect(page.locator('.canvas-context strong')).toContainText('Diagram 1 of 1');

  // The canvas keeps every pixel for the diagram; the composer lives in the drawer.
  await page.getByRole('button', { name: 'Close conversation' }).click();
  await expect(page.locator('.instruction-composer')).toHaveCount(0);

  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = page.locator('svg.ink-layer');
  const box = await ink.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .35);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .55, box!.y + box!.height * .55, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.canvas-ask-chip')).toContainText('1 marks');

  await openConversation.click();
  await expect(page.locator('.attachment-chip')).toContainText('1 marks');
  await page.getByRole('button', { name: 'Close conversation' }).click();

  await page.getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('.canvas-workspace')).toHaveClass(/focus-mode/);
  await openConversation.click();
  const revisionComposer = page.getByPlaceholder(/Ask about or revise/);
  await revisionComposer.fill('Revise it with a context step');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: /Previous version/ })).toBeVisible();
  await expect(page.locator('.canvas-context strong')).toContainText('Diagram 2 of 2');
  await page.getByRole('button', { name: 'Exit focus' }).click();

  await page.getByPlaceholder(/Ask about or revise/).fill('Show two alternatives');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.canvas-context strong')).toContainText('Diagram 2 of 4');
  await expect(page.locator('.notice-banner')).toContainText('2 diagram results');
  await expect(page.locator('.diagram-card')).toHaveCount(4);
  await expect(page.locator('.diagram-card-svg svg')).toHaveCount(4);
  await page.getByRole('button', { name: 'Close conversation' }).click();

  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.locator('.navigator-item')).toHaveCount(4);
  await page.getByRole('complementary', { name: 'Diagram history' }).locator('header button').click();

  await page.reload();
  await expect(page.locator('.diagram-canvas-shell')).toBeVisible();
  await expect(page.locator('.canvas-context strong')).toContainText('Diagram 2 of 4');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^cartograph-.*\.json$/);

  await page.screenshot({ path: 'test-results/cartograph-canvas.png', fullPage: true });
});
