import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '@/server/config';
import type { AgentProvider } from '@/shared/types';

export const DOCKER_PROFILE = 'codeai-docker-v1';
/**
 * The CLI versions a fresh provision installs, and the lowest an update may choose. The versions an
 * installation actually runs are host state in `<dataDir>/docker/versions.json`.
 */
export const DOCKER_VERSIONS = { claude: '2.1.226', codex: '0.152.0', node: '22.22.0' } as const;
/** Provisioning's build tag. Every worker and helper starts from the image ID in profile.json. */
export const DOCKER_IMAGE_TAG = `codeai-worker:${DOCKER_PROFILE}`;

/** Keeps an installation's recorded image from counting as dangling, whatever else is tagged. */
export function installationImageTag(owner: string): string {
  return `codeai-worker:${owner}`;
}
export const DOCKER_LABEL = 'io.codeai';
export const DOCKER_CONTEXT = '/context';
export const DOCKER_HOME = '/home/agent';
export const DOCKER_PATH = '/usr/local/bin:/usr/bin:/bin';

/** An exact release, as npm publishes one: no range, tag, prefix or pre-release. */
const CLI_VERSION = /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/;

export function isCliVersion(value: string): boolean {
  return CLI_VERSION.test(value);
}

/** Orders two exact releases numerically; both must satisfy isCliVersion. */
export function compareCliVersions(left: string, right: string): number {
  const [a, b] = [left, right].map((value) => value.split('.').map(Number));
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function dockerOwner(dataDirectory: string): string {
  let directory = path.resolve(dataDirectory);
  let suffix = '';
  // Resolve existing parents too: health may construct the runtime before the data directory
  // exists. Aliases must not evade recovery, and changing the host label must not change ownership.
  for (;;) {
    try {
      const canonical = path.join(realpathSync(/* turbopackIgnore: true */ directory), suffix);
      return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(directory) === directory) throw error;
      suffix = path.join(path.basename(directory), suffix);
      directory = path.dirname(directory);
    }
  }
}

export function participantVolume(owner: string, sessionId: string, participantId: string, kind: 'home' | 'cache'): string {
  const identity = createHash('sha256').update(`${sessionId}\0${participantId}`).digest('hex').slice(0, 24);
  return `codeai-${owner}-${identity}-${kind}`;
}

export function providerVolume(owner: string, provider: AgentProvider): string {
  return `codeai-${owner}-${provider}-home`;
}

/** Recheck immediately before every bind. Docker never resolves another mount through a symlink. */
export async function validateDockerCheckout(checkout: string, config: Pick<AppConfig, 'dataDir'>): Promise<{ uid: number; gid: number }> {
  if (await realpath(checkout) !== checkout || /[,\n\r\0]/.test(checkout)) {
    throw new Error('Docker requires a canonical checkout path without mount delimiters.');
  }
  const protectedPaths = [
    process.cwd(), config.dataDir, path.join(os.homedir(), '.codex'), path.join(os.homedir(), '.claude'),
    path.join(os.homedir(), '.docker'), path.join(os.homedir(), '.config'),
  ];
  for (const source of protectedPaths) {
    const protectedPath = await realpath(/* turbopackIgnore: true */ source).catch(() => path.resolve(/* turbopackIgnore: true */ source));
    if (within(checkout, protectedPath) || within(protectedPath, checkout)) {
      throw new Error('Docker cannot mount CodeAI’s installation, data, runtime configuration, or provider storage. Use a separately installed CodeAI.');
    }
  }
  const metadata = await lstat(path.join(checkout, '.git')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) {
    throw new Error('Docker does not support linked worktrees, symlinked .git, or external Git directories.');
  }
  // commondir redirects object/ref storage even when .git itself is a directory.
  if (await lstat(path.join(checkout, '.git', 'commondir')).catch(() => undefined)) {
    throw new Error('Docker does not support external Git metadata.');
  }
  const checkoutStat = await lstat(checkout);
  if (!checkoutStat.isDirectory()) throw new Error('Docker checkout must be a directory.');
  const uid = process.platform === 'linux' ? process.getuid?.() : 1000;
  const gid = process.platform === 'linux' ? process.getgid?.() : 1000;
  if (!uid || gid === undefined) throw new Error('Docker workers require a non-root owner.');
  return { uid, gid };
}

export function containerSecurity(uid: number, gid: number, providerProxy = false): string[] {
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error('Invalid non-root Docker identity.');
  }
  return [
    '--user', `${uid}:${gid}`, '--init', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true', '--cpus', '2', '--memory', '4g',
    '--memory-swap', '4g', '--pids-limit', '256', '--restart', 'no',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
    '--shm-size', '16m', '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2',
    // Docker CLI configuration otherwise injects host proxy URLs, potentially with credentials.
    ...Object.entries({
      HTTP_PROXY: providerProxy ? 'http://egress:8080' : '', HTTPS_PROXY: providerProxy ? 'http://egress:8080' : '',
      http_proxy: providerProxy ? 'http://egress:8080' : '', https_proxy: providerProxy ? 'http://egress:8080' : '',
      NO_PROXY: providerProxy ? 'egress' : '', no_proxy: providerProxy ? 'egress' : '',
      FTP_PROXY: '', ftp_proxy: '', ALL_PROXY: '', all_proxy: '',
    }).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
  ];
}
