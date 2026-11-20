import type { Page } from '@playwright/test';

/** Locate a scoped active session without relying on its editable title or tab order. */
export function sessionTab(page: Page, id: string) {
  return page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')
    .filter({ has: page.locator(`a[href*="session=${id}"]`) });
}

export async function selectedSessionId(page: Page) {
  const href = await page.getByRole('tab', { selected: true }).locator('a').getAttribute('href');
  return new URL(href!, 'http://localhost').searchParams.get('session')!;
}
