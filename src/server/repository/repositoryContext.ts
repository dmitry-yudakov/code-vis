import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ContextRecord {
  file: string;
  status: 'ready' | 'truncated' | 'unavailable';
  bytes: number;
  message?: string;
}

const COMMANDS: Array<{ file: string; args: string[] }> = [
  { file: 'git-status.txt', args: ['status', '--short'] },
  { file: 'working.diff', args: ['diff', '--no-ext-diff', '--'] },
  { file: 'staged.diff', args: ['diff', '--cached', '--no-ext-diff', '--'] },
  { file: 'last-commit.diff', args: ['diff', '--no-ext-diff', 'HEAD^..HEAD', '--'] },
];

function bounded(value: string, limit: number): { content: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= limit) return { content: value, truncated: false };
  const header = `[TRUNCATED: snapshot exceeded ${limit} bytes]\n`;
  return { content: header + bytes.subarray(0, Math.max(0, limit - Buffer.byteLength(header))).toString('utf8'), truncated: true };
}

export async function writeRepositoryContext(
  repositoryRoot: string,
  directory: string,
  maxTotalBytes: number,
): Promise<ContextRecord[]> {
  const perFileLimit = Math.max(1_024, Math.floor(maxTotalBytes / COMMANDS.length));
  const records: ContextRecord[] = [];
  for (const command of COMMANDS) {
    try {
      const { stdout } = await execFileAsync('git', command.args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: Math.max(perFileLimit * 2, 1_048_576),
        timeout: 15_000,
        windowsHide: true,
      });
      const snapshot = bounded(stdout, perFileLimit);
      // `directory` is a per-run temp directory, never a repository path; no build tracing is needed.
      await writeFile(path.join(/* turbopackIgnore: true */ directory, command.file), snapshot.content || '(no changes)\n', { mode: 0o600 });
      records.push({
        file: command.file,
        status: snapshot.truncated ? 'truncated' : 'ready',
        bytes: Buffer.byteLength(snapshot.content),
        message: snapshot.truncated ? 'Snapshot was truncated to its configured limit.' : undefined,
      });
    } catch (error) {
      const message = command.file === 'last-commit.diff'
        ? 'Last commit is unavailable (the repository may have fewer than two commits).'
        : 'Git context is unavailable (this may not be a Git repository).';
      await writeFile(path.join(/* turbopackIgnore: true */ directory, command.file), `[UNAVAILABLE] ${message}\n`, { mode: 0o600 });
      records.push({ file: command.file, status: 'unavailable', bytes: 0, message });
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
    }
  }
  await writeFile(path.join(directory, 'context-manifest.json'), `${JSON.stringify({ version: 1, snapshots: records }, null, 2)}\n`, { mode: 0o600 });
  return records;
}
