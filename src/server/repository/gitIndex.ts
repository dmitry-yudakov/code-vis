import { createHash } from 'node:crypto';
import type { GitWorkingTree } from '@/shared/types';
import { isNotRepositoryOutput, runGitRead } from './gitRead';
import { DETACHED_HEAD, parseGitStatus } from './gitRepository';

/** Porcelain v2 carries the displayed status, HEAD and staged blob/mode identities in one read.
 * Only staged data enters the token: later working edits must never invalidate a staged commit.
 * Output scales with changed paths rather than all tracked files in a large clean repository. */
export function parseGitIndexStatus(output: string): GitWorkingTree {
  const records = output.split('\0');
  const headers = new Map<string, string>();
  const status: string[] = [];
  const staged: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith('# ')) {
      const separator = record.indexOf(' ', 2);
      headers.set(record.slice(2, separator), record.slice(separator + 1));
      continue;
    }
    if (record.startsWith('? ')) { status.push(`?? ${record.slice(2)}`); continue; }
    const fields = record.split(' ');
    const kind = fields[0];
    if (!['1', '2', 'u'].includes(kind)) throw new Error('Invalid Git status.');
    const filePath = fields.slice(kind === '1' ? 8 : kind === '2' ? 9 : 10).join(' ');
    if (!filePath || fields[1].length !== 2) throw new Error('Invalid Git status.');
    status.push(`${fields[1].replaceAll('.', ' ')} ${filePath}`);
    const previousPath = kind === '2' ? records[++i] : undefined;
    if (kind === '2') {
      if (!previousPath) throw new Error('Invalid renamed path.');
      status.push(previousPath);
    }
    if (fields[1][0] !== '.') staged.push(JSON.stringify(kind === 'u'
      ? [filePath, fields[1][0], ...fields.slice(3, 6), ...fields.slice(7, 10)]
      : [filePath, previousPath, fields[1][0], fields[4], fields[7]]));
  }
  const head = headers.get('branch.head');
  const oid = headers.get('branch.oid');
  if (!head || !oid) throw new Error('Git status omitted HEAD.');
  const tree = parseGitStatus(status.join('\0') + '\0');
  const [ahead, behind] = (headers.get('branch.ab') || '+0 -0').split(' ').map(Number);
  return {
    ...tree, branch: head === '(detached)' ? DETACHED_HEAD : head,
    ...(oid === '(initial)' ? { unborn: true } : {}),
    ...(headers.has('branch.upstream') ? { upstream: headers.get('branch.upstream') } : {}),
    ...(ahead ? { ahead } : {}), ...(behind ? { behind: -behind } : {}),
    indexState: createHash('sha256').update(JSON.stringify([head, oid, staged.sort()])).digest('hex'),
  };
}

export async function readGitIndexStatus(cwd: string, checkoutWriteLease?: symbol): Promise<GitWorkingTree> {
  try {
    return parseGitIndexStatus(await runGitRead(cwd, [
      '-c', 'status.relativePaths=true', 'status', '--porcelain=v2', '-z', '--branch', '--renames', '--untracked-files=all', '--', '.',
    ], { checkoutWriteLease }));
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string; killed?: boolean };
    if (failure.code === 128 && isNotRepositoryOutput(failure.stderr)) return { isRepository: false, files: [] };
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('This working tree has too many changes to display (5 MiB limit).');
    if (failure.killed) throw new Error('Git status timed out. Refresh Changes and retry.');
    throw new Error('Could not read Git status. Refresh Changes and retry.');
  }
}

export async function readGitIndexState(cwd: string, checkoutWriteLease?: symbol): Promise<string> {
  const tree = await readGitIndexStatus(cwd, checkoutWriteLease);
  if (!tree.indexState) throw new Error('This folder is not a Git repository.');
  return tree.indexState;
}
