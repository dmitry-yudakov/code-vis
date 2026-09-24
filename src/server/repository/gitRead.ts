import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getConfig } from '@/server/config';
import { dockerCommand, localDockerEndpoint } from '@/server/execution/dockerCommand';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { containerSecurity } from '@/server/execution/dockerProfile';
import { runRegistry } from '@/server/runs/runRegistry';

export const GIT_READ_OPTIONS = [
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
  '-c', 'core.attributesFile=/dev/null',
  '-c', 'diff.external=', '-c', 'diff.trustExitCode=false', '-c', 'submodule.recurse=false',
  '-c', 'core.pager=cat', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
];

export function gitReadEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin:/usr/local/bin', HOME: '/nonexistent', LANG: 'C.UTF-8', NODE_ENV: 'production',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_LITERAL_PATHSPECS: '1',
  };
}

const PERSONAL_IGNORE_BYTES = 64 * 1024;
// The helper receives the patterns, never a host path, so Docker binds nothing but the checkout.
const HELPER_PERSONAL_IGNORE = '/tmp/personal-git-ignore';
const WRITE_PERSONAL_IGNORE = `printf %s "$CODEAI_PERSONAL_IGNORE" > ${HELPER_PERSONAL_IGNORE} && exec git "$@"`;

/** Git's default personal ignore file, located as Git locates it; a relative XDG_CONFIG_HOME is
 * ignored, as the XDG specification says. A custom core.excludesFile is not followed: that would
 * mean reading global Git configuration. Anything but a regular file of at most
 * PERSONAL_IGNORE_BYTES of UTF-8 without NUL bytes, which an environment value must be, reads as no
 * file, in both modes alike. */
async function personalIgnore(): Promise<{ file: string; patterns: string } | undefined> {
  const configHome = process.env.XDG_CONFIG_HOME;
  const file = path.join(configHome && path.isAbsolute(configHome) ? configHome : path.join(os.homedir(), '.config'), 'git', 'ignore');
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > PERSONAL_IGNORE_BYTES) return undefined;
    // Checked again after reading: the file may have grown in between.
    const bytes = await readFile(file);
    if (bytes.length > PERSONAL_IGNORE_BYTES || bytes.includes(0)) return undefined;
    return { file, patterns: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch { return undefined; }
}

/** Provisioning permanently switches this installation's Git reads to a credential-free helper.
 * Disabling Docker turns does not restore host Git on a checkout a worker could have changed.
 */
export async function runGitRead(cwd: string, args: string[], options: {
  allowedExitCodes?: number[]; maxBuffer?: number; timeout?: number;
} = {}): Promise<string> {
  const release = runRegistry.acquireCheckoutRead(cwd);
  if (!release) throw new Error('An enclosing checkout is being edited. Retry this Git read after that turn finishes.');
  try { return await executeGitRead(cwd, args, options); }
  finally { release(); }
}

async function executeGitRead(cwd: string, args: string[], options: {
  allowedExitCodes?: number[]; maxBuffer?: number; timeout?: number;
}): Promise<string> {
  const config = getConfig();
  await recoverDockerExecution(config);
  // Only the provisioning record decides: enabling Docker first leaves host Git in place.
  let isolated = false;
  try { await access(path.join(config.dataDir, 'docker', 'profile.json')); isolated = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const ignore = await personalIgnore();
  const hardenedArgs = (excludesFile: string) => [...GIT_READ_OPTIONS, '-c', `core.excludesFile=${excludesFile}`, ...args];
  if (!isolated) return new Promise((resolve, reject) => {
    execFile('git', hardenedArgs(ignore?.file ?? '/dev/null'), {
      cwd, env: { ...gitReadEnvironment(), HOME: os.homedir(), GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
      encoding: 'utf8', maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024,
      timeout: options.timeout ?? 8_000, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error || (typeof error.code === 'number' && options.allowedExitCodes?.includes(error.code))) resolve(stdout);
      else reject(Object.assign(error, { stderr }));
    });
  });
  const runtime = getDockerRuntime(config);
  const profile = await runtime.provision();
  const endpoint = await localDockerEndpoint();
  const command = (params: string[], env?: Record<string, string>) => dockerCommand(['--host', endpoint, ...params], { env });
  if ((await command(['info', '--format', '{{.ID}}'])).trim() !== profile.engineId) throw new Error('Docker engine identity changed; Git read refused.');
  // A helper intentionally accepts replaced .git: it has no host files outside this one bind.
  // Canonical root validation still precedes every mount; no parent paths are ever mounted.
  if (await realpath(cwd) !== cwd || /[,\r\n\0]/.test(cwd)) throw new Error('Checkout path changed before the isolated Git read.');
  const uid = process.platform === 'linux' ? process.getuid?.() : 1000;
  const gid = process.platform === 'linux' ? process.getgid?.() : 1000;
  if (!uid || gid === undefined) throw new Error('Isolated Git requires a non-root owner.');
  const container = (await command([
    'create', '--name', `codeai-git-${randomUUID()}`, ...runtime.labels('git'), ...containerSecurity(uid, gid),
    '--network', 'none', '--mount', `type=bind,src=${cwd},dst=/workspace,readonly`, '--workdir', '/workspace',
    ...Object.entries(gitReadEnvironment()).filter(([key]) => key !== 'PATH').flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    // Docker copies this value from its own environment, so the patterns stay out of command lines.
    // The image's entrypoint would run a non-executable checkout file named like the command with
    // node, so the absolute shell replaces it.
    '--env', 'CODEAI_PERSONAL_IGNORE', '--entrypoint', '/bin/sh', profile.image, '-c', WRITE_PERSONAL_IGNORE,
    'sh', '-c', 'safe.directory=/workspace', ...hardenedArgs(HELPER_PERSONAL_IGNORE),
  ], { CODEAI_PERSONAL_IGNORE: ignore?.patterns ?? '' })).trim();
  try {
    // The attached result carries Git's exit status; all failures are bounded and path-free.
    return await new Promise<string>((resolve, reject) => {
      execFile('docker', ['--host', endpoint, 'start', '--attach', container], {
        cwd: os.tmpdir(), env: { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', HOME: os.homedir(), NODE_ENV: 'production' },
        encoding: 'utf8', maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024, timeout: options.timeout ?? 15_000,
      }, (error, stdout, stderr) => {
        if (!error || (typeof error.code === 'number' && options.allowedExitCodes?.includes(error.code))) resolve(stdout);
        else reject(Object.assign(new Error('Isolated Git read failed or exceeded its limits.'), {
          code: error.code, killed: error.killed,
          // Classify only; never expose repository-controlled error text.
          stderr: error.code === 128 && stderr.toLowerCase().includes('not a git repository')
            ? 'not a git repository' : undefined,
        }));
      });
    });
  } finally { await runtime.removeContainer(command, container); }
}
