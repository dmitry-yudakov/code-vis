import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderTokensCss } from '../scripts/generate-tokens';

const globalsPath = new URL('../src/app/globals.css', import.meta.url);
const tokensPath = new URL('../src/app/tokens.css', import.meta.url);
const sourcePath = new URL('../src/shared/design/tokens.ts', import.meta.url);

describe('design tokens', () => {
  it('keeps the shared token source side-effect free', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\b(?:document|window|navigator)\b|node:/);
  });

  it('keeps globals.css free of color literals', async () => {
    const css = await readFile(globalsPath, 'utf8');

    expect(css).toMatch(/^@import ['"]\.\/tokens\.css['"];\n/);
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\s*\(/gi)).toBeNull();
  });

  it('keeps the committed generated CSS in byte-for-byte parity', async () => {
    const css = await readFile(tokensPath, 'utf8');

    expect(css).toBe(renderTokensCss());
    expect(
      css
        .split('\n')
        .slice(2, -2)
        .every((line) => /^  --[a-z0-9-]+: .+;$/.test(line)),
    ).toBe(true);
  });
});
