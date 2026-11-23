import { expect, type Page } from '@playwright/test';

/** Select a workspace view through its visible control at the current viewport. */
export async function selectWorkspaceView(page: Page, name: string | RegExp, { ensureOpen = false } = {}) {
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  await expect(navigation).toBeVisible();
  const direct = navigation.getByRole('button', { name, exact: true });
  if (await direct.isVisible()) {
    if (!ensureOpen || await direct.getAttribute('aria-pressed') !== 'true') await direct.click();
    return;
  }
  const more = navigation.getByRole('button', { name: 'More', exact: true });
  await more.click();
  const item = page.locator('.desktop-picker-paper:visible').getByRole('button', { name, exact: true });
  if (!ensureOpen || await item.getAttribute('aria-pressed') !== 'true') await item.click();
  else await more.press('Escape');
}
