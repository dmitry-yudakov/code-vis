import { access, stat, readdir, lstat, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const command = process.argv[2];
if (command === 'prepare') {
  const git = await lstat('/workspace/.git').catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (git) {
    if (!git.isDirectory() || git.isSymbolicLink()) throw new Error('External Git metadata is unsupported');
    const metadata = ['/workspace/.git'];
    let count = 0;
    while (metadata.length) {
      const directory = metadata.shift();
      if (++count > 10_000) throw new Error('Git metadata directory limit exceeded');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Symlinked Git metadata is unsupported');
        if (entry.isDirectory()) metadata.push(`${directory}/${entry.name}`);
      }
    }
    if (await lstat('/workspace/.git/commondir').catch(() => undefined)) throw new Error('External Git metadata is unsupported');
    const alternates = await readFile('/workspace/.git/objects/info/alternates', 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (alternates.trim()) throw new Error('Alternate Git object stores are unsupported');
    const config = (args) => {
      const result = spawnSync('git', ['config', '--no-includes', '--file', '/workspace/.git/config', ...args], {
        encoding: 'utf8', maxBuffer: 16_384, timeout: 5000,
        env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
      });
      if (![0, 1].includes(result.status)) throw new Error('Invalid Git configuration');
      return result.stdout.trim();
    };
    if (config(['--get-regexp', '^(include|includeif\\..*)\\.path$'])) throw new Error('Git config includes are unsupported in this Docker profile');
    const worktree = config(['--get', 'core.worktree']);
    if (worktree && path.resolve('/workspace/.git', worktree) !== '/workspace') throw new Error('External Git working trees are unsupported');
  }
} else if (command === 'access') {
  if (!process.getuid()) throw new Error('Worker must not run as root');
  await access('/workspace', constants.R_OK | constants.X_OK | (process.argv[3] === 'agent' ? constants.W_OK : 0));
  if (!(await stat('/workspace')).isDirectory()) throw new Error('Workspace unavailable');
} else throw new Error('Unknown worker operation');
