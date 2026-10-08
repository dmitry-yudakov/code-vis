import { expect, type Page } from '@playwright/test';

export async function openMachineSettings(page: Page) {
  await page.locator('.more-menu > summary').click();
  await page.getByRole('button', { name: 'Machine settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machine settings', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
