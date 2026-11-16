import type { GitCommitDetails, GitHistory } from '@/shared/types';
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

const FULL_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

async function commitRead(cwd: string, args: string[]): Promise<string> {
  try { return await runGitRead(cwd, args, { maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) {
    if ((error as { code?: string }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('Commit details exceed the 2 MiB display limit. Inspect this commit in a terminal.');
    throw new Error('Could not read this commit. Refresh History and try again.');
  }
}

export async function readGitCommit(cwd: string, hash: string): Promise<GitCommitDetails> {
  if (!FULL_HASH.test(hash)) throw new Error('Choose a full commit hash from History.');
  const metadata = await commitRead(cwd, ['show', '--no-patch', '--no-notes', '--no-show-signature', '--encoding=UTF-8', '--format=%H%x00%an%x00%ae%x00%aI%x00%P%x00%B', hash, '--']);
  const [actual, author, email, date, parents, ...message] = metadata.split('\0');
  if (actual !== hash || !Number.isFinite(Date.parse(date)) || (parents && parents.split(' ').some(parent => !FULL_HASH.test(parent)))) throw new Error('Invalid commit details.');
  const parentList = parents ? parents.split(' ') : [];
  const entries = (await commitRead(cwd, ['diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', '-z',
    ...(parentList.length ? [parentList[0], hash] : [hash]), '--'])).split('\0');
  if (entries.at(-1) === '') entries.pop();
  const files: GitCommitDetails['files'] = [];
  for (let i = 0; i < entries.length;) {
    const status = entries[i++];
    const first = entries[i++];
    const renamed = /^[RC]/.test(status);
    const filePath = renamed ? entries[i++] : first;
    if (!filePath || !/^[A-Z][0-9]*$/.test(status)) throw new Error('Invalid commit file list.');
    files.push({ path: filePath, status, ...(renamed ? { previousPath: first } : {}) });
  }
  return { hash, author, email, date, parents: parentList, message: message.join('\0').trimEnd(), files };
}

export async function readGitCommitPatch(cwd: string, hash: string, filePath: string): Promise<string> {
  const details = await readGitCommit(cwd, hash);
  const file = details.files.find(item => item.path === filePath);
  if (!file) throw new Error('Choose a file changed in this commit.');
  const common = ['--no-ext-diff', '--no-textconv', '--no-color', '-M', '--unified=3'];
  const paths = [file.path, ...(file.previousPath ? [file.previousPath] : [])];
  return commitRead(cwd, details.parents.length
    ? ['diff', ...common, details.parents[0], hash, '--', ...paths]
    : ['show', ...common, '--no-notes', '--no-show-signature', '--format=', '--root', hash, '--', ...paths]);
}
