import { expect, it } from 'vitest';
import { fuzzyFiles } from '@/features/repository/fuzzyFiles';

const files = ['docs/architecture.md', 'src/features/shell/AppShell.tsx', 'package.json', 'src/package.json', 'README.md']
  .map(path => ({ path }));

it('matches case-insensitive noncontiguous characters and paths', () => {
  expect(fuzzyFiles(files, 'apsh')).toEqual([{ path: 'src/features/shell/AppShell.tsx' }]);
  expect(fuzzyFiles(files, 'DOC arch')).toEqual([{ path: 'docs/architecture.md' }]);
  expect(fuzzyFiles(files, 'xyz')).toEqual([]);
});

it('ranks exact file names, prefixes and contiguous matches before scattered matches', () => {
  const candidates = ['src/p-a-c-k.ts', 'docs/backpack.md', 'src/package.json', 'package.json', 'pack'].map(path => ({ path }));
  expect(fuzzyFiles(candidates, 'pack').map(file => file.path)).toEqual([
    'pack', 'package.json', 'src/package.json', 'docs/backpack.md', 'src/p-a-c-k.ts',
  ]);
});

it('caps rendered results without truncating the searchable file collection', () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ path: `file-${i}.txt`, checkoutId: 'alpha' }));
  expect(fuzzyFiles(many, '')).toHaveLength(50);
  expect(fuzzyFiles(many, 'file-999.txt')).toEqual([many[999]]);
  expect(fuzzyFiles(files, '  ', 2)).toEqual(files.slice(0, 2));
});
