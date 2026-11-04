import type { GitHistory } from '@/shared/types';
import { isNotRepositoryOutput, runGitRead } from './gitRead';

/** Fixed, credential-free reads share status/diff's checkout ownership and Docker transport. */
export async function readGitHistory(repositoryPath: string): Promise<GitHistory> {
  try {
    // Resolve once, including unborn/detached HEAD; do not parse repository-controlled errors.
    const head = (await runGitRead(repositoryPath, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowedExitCodes: [1] })).trim();
    if (!head) return { isRepository: true, commits: [], truncated: false };
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('Invalid HEAD.');
    const output = await runGitRead(repositoryPath, [
      'log', '--max-count=101', '--date-order', '--no-decorate', '--no-notes', '--no-show-signature',
      '--encoding=UTF-8', '--format=%H%x00%an%x00%aI%x00%s', '-z', head, '--',
    ], { maxBuffer: 2 * 1024 * 1024 });
    const fields = output.split('\0');
    if (fields.at(-1) === '') fields.pop();
    if (fields.length % 4) throw new Error('Incomplete history.');
    const commits: GitHistory['commits'] = [];
    for (let i = 0; i < fields.length; i += 4) {
      const [hash, author, date, subject] = fields.slice(i, i + 4);
      if (!/^[a-f0-9]{40,64}$/.test(hash) || !Number.isFinite(Date.parse(date))) throw new Error('Invalid commit.');
      commits.push({ hash, author, date, subject });
    }
    return { isRepository: true, commits: commits.slice(0, 100), truncated: commits.length > 100 };
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string; killed?: boolean };
    if (failure.code === 128 && isNotRepositoryOutput(failure.stderr)) return { isRepository: false, commits: [], truncated: false };
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Git history exceeds the 2 MiB display limit.');
    if (failure.killed) throw new Error('Reading Git history timed out. Try again.');
    throw new Error('Could not read Git history. Try again.');
  }
}
