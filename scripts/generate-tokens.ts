import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { effects, fonts, palette } from '@/shared/design/tokens';

const GENERATED_HEADER =
  '/* Generated from src/shared/design/tokens.ts by scripts/generate-tokens.ts. Do not edit. */';

function cssName(name: string): string {
  return name
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/([a-z])(\d)/g, '$1-$2');
}

export function renderTokensCss(): string {
  const declarations = [
    ...Object.entries(palette.light),
    ...Object.entries(effects.light),
    ...Object.entries(fonts),
  ].map(([name, value]) => `  --${cssName(name)}: ${value};`);

  return `${GENERATED_HEADER}\n:root {\n${declarations.join('\n')}\n}\n`;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';

if (import.meta.url === entryPath) {
  void writeFile(resolve(process.cwd(), 'src/app/tokens.css'), renderTokensCss(), 'utf8').catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
