import { expect, test, type Page } from '@playwright/test';
import { openMachineSettings } from './machine-settings';
import { LIGHT_THEMES, palette } from '../src/shared/design/tokens';

async function openAppearance(page: Page) {
  await page.locator('.more-menu > button').click();
  return page.locator('.desktop-picker-paper:visible');
}

test('light palette selection persists and System restores it after dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/arena');
  let menu = await openAppearance(page);
  await menu.getByRole('button', { name: 'Light', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Light palette' }).selectOption('steel');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'steel');
  await menu.getByRole('combobox', { name: 'Light palette' }).selectOption('sand');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'sand');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'sand');
  menu = await openAppearance(page);
  await expect(menu.getByRole('combobox', { name: 'Light palette' })).toHaveValue('sand');
  await menu.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(menu.getByRole('combobox', { name: 'Light palette' })).toBeHidden();
  await menu.getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect(menu.getByRole('combobox', { name: 'Light palette' })).toHaveValue('sand');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'sand');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'sand');
  await menu.getByRole('combobox', { name: 'Light palette' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
});

for (const theme of ['light', 'steel', 'sand'] as const) {
  test(`saved ${theme} palette matches MUI before hydration under a dark OS`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript((lightTheme) => {
      localStorage.setItem('code-ai:theme', 'light');
      localStorage.setItem('code-ai:light-theme', lightTheme);
    }, theme);
    await page.route('**/_next/static/**/*.js', route => route.abort());
    await page.goto('/arena');
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
    expect(await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return { paper: css.getPropertyValue('--mui-palette-background-paper').trim(),
        raised: css.getPropertyValue('--raised').trim(), colorScheme: css.colorScheme };
    })).toEqual({ paper: palette[theme].raised, raised: palette[theme].raised, colorScheme: 'light' });
  });

  for (const width of [1440, 390]) {
    test(`${LIGHT_THEMES[theme]} controls and surfaces at ${width}px`, async ({ page, request }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (/hydration|did not match|server rendered/i.test(message.text())) errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.addInitScript((lightTheme) => {
        localStorage.setItem('code-ai:theme', 'light');
        localStorage.setItem('code-ai:light-theme', lightTheme);
      }, theme);
      const { checkouts } = await (await request.get('/api/checkouts')).json();
      const { project } = await (await request.post('/api/projects', { data: {
        name: `${LIGHT_THEMES[theme]} workspace`, checkoutIds: [checkouts.find((item: { name: string }) => item.name === 'alpha').id],
      } })).json();
      const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
      await page.goto(`/?session=${session.id}`);
      const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
      await expect(input).toBeVisible();
      await input.fill('Explore the repository and draw its architecture.');
      await expect(page.locator('html')).toHaveAttribute('data-appearance', theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-workspace.png`) });
      const menu = await openAppearance(page);
      await expect(menu.getByRole('combobox', { name: 'Light palette' })).toHaveValue(theme);
      expect(await menu.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-appearance.png`) });
      await page.keyboard.press('Escape');
      const settings = await openMachineSettings(page);
      // Portals must receive the same actual surface as native CSS panes.
      expect(await settings.evaluate(element => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--raised)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(element).backgroundColor === expected;
      })).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test('unavailable storage keeps System and Classic usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked'); };
  });
  await page.goto('/arena');
  const menu = await openAppearance(page);
  await menu.getByRole('combobox', { name: 'Light palette' }).selectOption('steel');
  await expect(menu.getByRole('combobox', { name: 'Light palette' })).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
});
