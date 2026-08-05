import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { writeRepositoryContext } from '@/lib/server/repositoryContext';

const exec = promisify(execFile);

describe('writeRepositoryContext', () => {
  it('writes bounded, read-only git snapshots and a manifest', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'web2-git-'));
    const output = await mkdtemp(path.join(os.tmpdir(), 'web2-git-output-'));
    await exec('git', ['init'], { cwd: project });
    await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: project });
    await writeFile(path.join(project, 'file.txt'), 'base\n');
    await exec('git', ['add', 'file.txt'], { cwd: project });
    await exec('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'base'], { cwd: project });
    await writeFile(path.join(project, 'file.txt'), `base\n${'change\n'.repeat(100)}`);
    const records = await writeRepositoryContext(project, output, 4_096);
    expect(records.map((item) => item.file)).toEqual(['git-status.txt', 'working.diff', 'staged.diff', 'last-commit.diff']);
    expect(await readFile(path.join(output, 'git-status.txt'), 'utf8')).toContain('file.txt');
    expect(JSON.parse(await readFile(path.join(output, 'context-manifest.json'), 'utf8')).version).toBe(1);
  });
});
