import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEvidence } from '@/features/diagram/evidence';

describe('extractEvidence', () => {
  it('validates real ranges and rejects traversal and symlink escape', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-evidence-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-evidence-outside-'));
    await writeFile(path.join(root, 'safe.ts'), 'a\nb\n');
    await writeFile(path.join(outside, 'secret.ts'), 'secret\n');
    await symlink(path.join(outside, 'secret.ts'), path.join(root, 'link.ts'));
    const results = await extractEvidence(`
%%@evidence A | safe.ts:1-2 | observed
%%@evidence B | ../secret.ts:1 | inferred
%%@evidence C | link.ts:1 | observed
%%@evidence D | safe.ts:99 | observed`, root);
    expect(results.map((item) => item.status)).toEqual(['observed', 'outside-repository', 'outside-repository', 'invalid-range']);
    expect(JSON.stringify(results)).not.toContain(outside);
  });
});
