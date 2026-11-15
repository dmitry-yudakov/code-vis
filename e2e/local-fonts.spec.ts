import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 360]) {
    test(`bundled fonts load locally and retain variable width: ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
      const externalRequests: string[] = [];
      const fontResponses: number[] = [];
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== new URL(testInfo.project.use.baseURL!).origin) {
          externalRequests.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      page.on('response', response => {
        if (response.request().resourceType() === 'font') fontResponses.push(response.status());
      });
      await page.goto('/arena');
      await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
      const typography = await page.evaluate(async () => {
        const css = getComputedStyle(document.documentElement);
        const families = ['geist', 'geist-mono', 'archivo', 'inter']
          .map(name => css.getPropertyValue(`--font-${name}`).trim());
        const loaded = await Promise.all(families.map(async family => {
          const faces = await document.fonts.load(`400 18px ${family}`, 'CodeAI Пример');
          return faces.length > 0 && faces.every(face => face.status === 'loaded');
        }));
        const semibold = await document.fonts.load(`600 18px ${families[3]}`);
        const probe = document.createElement('span');
        probe.textContent = 'CodeAI';
        probe.style.cssText = `position:absolute;white-space:nowrap;font-family:${families[2]};font-size:32px;font-stretch:62%`;
        document.body.append(probe);
        const narrow = probe.getBoundingClientRect().width;
        probe.style.fontStretch = '125%';
        const wide = probe.getBoundingClientRect().width;
        probe.remove();
        return { loaded, semibold: semibold.length, narrow, wide };
      });
      expect(typography.loaded).toEqual([true, true, true, true]);
      expect(typography.semibold).toBeGreaterThan(0);
      expect(typography.wide).toBeGreaterThan(typography.narrow * 1.5);
      expect(externalRequests).toEqual([]);
      expect(fontResponses).toEqual([200, 200, 200, 200]);
      // Geist, Geist Mono and Archivo retain preloading; Inter is loaded only on demand.
      await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(3);
      await page.screenshot({ path: testInfo.outputPath('local-fonts.png'), animations: 'disabled' });
    });
  }
}
