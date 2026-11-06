import { expect, it } from 'vitest';
import { localFileLink } from '@/features/repository/localFileLinks';

it.each([
  ['src/app.ts:12', { path: 'src/app.ts', line: 12 }],
  ['src/app.ts:12-18', { path: 'src/app.ts', line: 12, endLine: 18 }],
  ['src/app.ts:12:4', { path: 'src/app.ts', line: 12 }],
  ['src/app.ts#L12-L18', { path: 'src/app.ts', line: 12, endLine: 18 }],
  ['/home/user/project/a.ts#L2', { path: '/home/user/project/a.ts', line: 2 }],
  ['file:///home/user/project/a%20b.ts:3', { path: '/home/user/project/a b.ts', line: 3 }],
  ['./docs/a%20b.md', { path: './docs/a b.md' }],
  ['README.md#setup', { path: 'README.md', anchor: 'setup' }],
] as const)('parses repository file reference %s', (href, expected) => {
  expect(localFileLink(href)).toEqual(expected);
});

it('resolves document links relative to the viewed document', () => {
  expect(localFileLink('../README.md#setup', 'docs/guide.md')).toEqual({ path: 'docs/../README.md', anchor: 'setup' });
  expect(localFileLink('#details', 'docs/guide.md')).toEqual({ path: 'docs/guide.md', anchor: 'details' });
  expect(localFileLink('/project/a.ts', 'docs/guide.md')).toEqual({ path: '/project/a.ts' });
});

it.each(['https://example.com/a.md', 'mailto:a@b.com', 'javascript:alert(1)', 'data:text/html,hi',
  '//example.com/a.md', 'file://other-host/etc/passwd', 'vscode://file/a.ts', '#heading', '', '%00', '%zz',
  'src/a.ts:0', 'src/a.ts:999999999999999999999', 'src/a.ts#L9-L2', 'a\\b.ts'])('does not resolve invalid or non-file link %s', href => {
  expect(localFileLink(href)).toBeUndefined();
});
