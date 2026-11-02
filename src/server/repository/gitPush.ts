import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import type { GitWorkingTree } from '@/shared/types';
import { GIT_READ_OPTIONS, runGitRead } from './gitRead';
import { DETACHED_HEAD } from './gitRepository';
import { containedMetadata, readWorktreeRecords, validateManagedPath } from './managedWorktrees';

const PUSH_TIMEOUT_MS = 120_000;
const PUSH_OUTPUT_CHARACTERS = 64 * 1024;
const EXIT_DRAIN_MS = 100;
/** Local paths would run the target's hooks, `ext` is a shell, and `http` sends credentials in the clear. */
const PUSH_PROTOCOLS = 'https:ssh';
/** What may reach Git besides what it sets for itself: the user's own credential and SSH setup. */
const PUSH_ENVIRONMENT = ['USER', 'LOGNAME', 'SSH_AUTH_SOCK', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];

/**
 * Push runs on the host with the user's credentials, under a `.git/config` a Docker worker or an
 * Auto turn in a nested repository may have written, and Git runs commands that file names. Local
 * keys are therefore allowed, not denied: Git's list of keys that execute or redirect keeps growing.
 * `core.hooksPath` may stay because the push overrides it, and only hook detection reads it.
 */
const ALLOWED_LOCAL_KEY = new RegExp(`^(?:${[
  'core\\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|hookspath)',
  'user\\.(?:name|email|signingkey)', 'commit\\.gpgsign', 'pull\\.(?:rebase|ff)', 'fetch\\.prune', 'rerere\\.enabled',
  'remote\\.pushdefault', 'remote\\..+\\.(?:url|pushurl|fetch|tagopt|prune|gh-resolved)', 'branch\\..+\\.[^.]+', 'submodule\\..+\\.(?:url|active)',
].join('|')})$`, 's');

type GitConfiguration = Map<string, string[]>;
interface PushPlan { remote: string; target: string; publish: boolean }

function configuration(output: string): GitConfiguration {
  const config: GitConfiguration = new Map();
  for (const entry of output.split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\n');
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const values = config.get(key) || [];
    values.push(separator === -1 ? '' : entry.slice(separator + 1));
    config.set(key, values);
  }
  return config;
}

function gate(config: GitConfiguration): void {
  const refused = [...config.keys()].find((key) => !ALLOWED_LOCAL_KEY.test(key));
  if (refused) throw new Error(`This repository's Git configuration sets ${redactUserInfo(refused)}, which CodeAI does not push under. Push from a terminal.`);
}

/** Always send the current branch to its own name, including when it was cut from origin/main.
 * Fetch refspecs and push.default cannot change the destination printed on the button. */
function pushPlan(config: GitConfiguration, branch: string): PushPlan | undefined {
  const last = (key: string) => config.get(key)?.at(-1);
  const remotes = [...config.keys()].flatMap((key) => key.match(/^remote\.(.+)\.url$/s)?.[1] ?? []);
  const upstream = last(`branch.${branch}.remote`);
  const merges = config.get(`branch.${branch}.merge`) || [];
  if (merges.length > 1) return;
  const remote = last(`branch.${branch}.pushremote`) || last('remote.pushdefault')
    || (upstream !== '.' ? upstream : undefined) || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined);
  if (!remote || remote === '.' || !remotes.includes(remote)) return;
  // A triangular workflow keeps its fetch upstream. Publishing a differently named tracking
  // branch on the same remote replaces that upstream with the newly published branch.
  return { remote, target: `${remote}/${branch}`, publish: !upstream || upstream === '.' || upstream === remote && merges[0] !== `refs/heads/${branch}` };
}

const within = (root: string, location: string) => location === root || location.startsWith(`${root}${path.sep}`);

/** npm puts checkout-writable node_modules/.bin first; neither Git nor its helpers may use it. */
async function pushEnvironment(cwd: string): Promise<NodeJS.ProcessEnv> {
  const config = getConfig();
  const home = os.homedir();
  const roots = await Promise.all([cwd, config.installationRoot, config.repositoriesRoot, config.worktreesRoot, os.tmpdir()]
    .filter(Boolean).map(async root => realpath(root).catch(() => path.resolve(root))));
  const userBins = ['bin', '.local/bin', '.cargo/bin', '.nvm', '.volta/bin', '.asdf/shims'].map(dir => path.join(/* turbopackIgnore: true */ home, dir));
  const entries = await Promise.all((process.env.PATH || '/usr/local/bin:/usr/bin:/bin').split(path.delimiter).map(async entry => {
    if (!path.isAbsolute(entry)) return;
    const canonical = await realpath(entry).catch(() => path.resolve(entry));
    if (canonical.split(path.sep).includes('node_modules')) return;
    const userBin = userBins.some(root => within(root, canonical));
    if (roots.some(root => within(root, canonical) && !(userBin && within(root, home)))) return;
    return canonical;
  }));
  return {
    ...Object.fromEntries(PUSH_ENVIRONMENT.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : [])),
    PATH: entries.filter(Boolean).join(path.delimiter), HOME: home, NODE_ENV: 'production', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: PUSH_PROTOCOLS,
    GIT_NO_REPLACE_OBJECTS: '1', GIT_CEILING_DIRECTORIES: path.dirname(cwd),
  };
}

const redactUserInfo = (text: string) => text.replaceAll(/:\/\/[^\s/]*@/g, '://');

/** What a failed push tells the user: the remote's own reason matters, its URL's secrets do not. */
export function pushFailureMessage(stderr: string): string {
  const text = redactUserInfo(stderr).trim();
  if (/transport '[^']*' not allowed/.test(text)) return 'CodeAI pushes over HTTPS and SSH only. Push to this remote from a terminal.';
  if (/\bnon-fast-forward\b|\bfetch first\b/.test(text)) return 'The remote has commits this branch lacks. Pull them first, then push again.';
  return text ? `Push failed: ${text.slice(-480)}` : 'Push failed.';
}

/** Run host Git in its own session: without a controlling terminal, ssh fails instead of prompting
 * on the server's, and the limit can stop the transport along with Git. */
async function hostGit(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  const env = await pushEnvironment(cwd);
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    let overflow = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      overflow ||= stdout.length + chunk.length > PUSH_OUTPUT_CHARACTERS;
      stdout = (stdout + chunk).slice(0, PUSH_OUTPUT_CHARACTERS);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-PUSH_OUTPUT_CHARACTERS); });
    const limit = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(limit);
      if (code === 0 && !overflow) resolve(stdout);
      else if (overflow) reject(new Error('Git output exceeded the inspection limit. Push from a terminal.'));
      else reject(new Error(timedOut ? 'Push timed out.' : pushFailureMessage(stderr)));
    };
    child.once('error', () => { clearTimeout(limit); reject(new Error('Git is not installed or is not available to CodeAI.')); });
    child.once('close', finish);
    // An ssh ControlPersist master outlives Git and keeps stderr open, so `close` may never come.
    child.once('exit', (code) => {
      clearTimeout(limit);
      setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(code); }, EXIT_DRAIN_MS);
    });
  });
}

/** Refuse if anything is using the path, then keep writers out while status reads continue. */
function excludeWriters(checkoutPath: string): (() => void) | undefined {
  const writer = runRegistry.acquireCheckoutWrite(checkoutPath);
  if (!writer) return undefined;
  try { return runRegistry.acquireCheckoutRead(checkoutPath, writer.token); } finally { writer(); }
}

/**
 * Send the current branch to the destination printed on the button. `target` is only compared.
 * No writer may run from before the configuration is checked
 * until Git exits, or the check would prove nothing; that covers a managed worktree's source, whose
 * `.git/config` the worktree reads.
 */
export async function pushCurrentBranch(cwd: string, target: string, timeoutMs = PUSH_TIMEOUT_MS): Promise<string> {
  const managed = await validateManagedPath(cwd);
  const source = managed?.originPath || cwd;
  const releases: (() => void)[] = [];
  const hold = (location: string) => {
    const release = excludeWriters(location);
    if (!release) throw new Error('An agent turn or another Git operation is using this checkout. Push after it finishes.');
    releases.push(release);
  };
  try {
    for (const location of new Set([cwd, source])) hold(location);
    // Holding the source also excludes worktree creation while this journal snapshot is read.
    const records = await readWorktreeRecords(getConfig().dataDir);
    for (const record of records) if (record.originPath === source && record.destination !== cwd) hold(record.destination);
    const read = (args: string[], allowedExitCodes?: number[]) => runGitRead(cwd, args, { allowedExitCodes })
      .catch(() => { throw new Error('Could not read this repository\'s Git configuration.'); });
    const head = (await read(['symbolic-ref', '-q', 'HEAD'], [1])).trim();
    const stale = () => new Error('The current branch or push destination has changed. Refresh Changes and try again.');
    if (!head.startsWith('refs/heads/')) throw stale();
    const branch = head.slice('refs/heads/'.length);
    gate(configuration(await read(['config', '--local', '--no-includes', '--list', '-z'])));
    const metadata = path.join(source, '.git');
    const info = await lstat(metadata);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('This repository links its Git metadata outside the checkout. Push from a terminal.');
    try {
      await containedMetadata(metadata);
      for (const file of ['commondir', 'config.worktree', 'objects/info/alternates', 'objects/info/http-alternates']) {
        if (await lstat(path.join(/* turbopackIgnore: true */ metadata, file)).catch(() => undefined)) throw new Error('External Git metadata');
      }
    } catch { throw new Error('This repository links its Git metadata outside the checkout or exceeds the inspection limit. Push from a terminal.'); }
    // From here the configuration has passed the gate, so host Git may read it. A global hooks path counts too.
    const plan = pushPlan(configuration(await hostGit(cwd, [...GIT_READ_OPTIONS, 'config', '--list', '-z'], timeoutMs)), branch);
    if (!plan || plan.target !== target) throw stale();
    const prePush = await hostGit(cwd, ['-c', 'safe.bareRepository=explicit', '-c', 'core.fsmonitor=false', 'rev-parse', '--git-path', 'hooks/pre-push'], timeoutMs);
    if (await access(path.resolve(cwd, prePush.trim()), constants.X_OK).then(() => true, () => false)) {
      throw new Error('This repository has a pre-push hook, which CodeAI does not run. Push from a terminal.');
    }
    await hostGit(cwd, [
      ...GIT_READ_OPTIONS, 'push', '--no-follow-tags', '--recurse-submodules=no',
      ...(plan.publish ? ['--set-upstream'] : []), '--', plan.remote, `HEAD:refs/heads/${branch}`,
    ], timeoutMs);
    return plan.target;
  } finally {
    for (const release of releases.reverse()) release();
  }
}

/** Status remains useful when push configuration cannot be read. This is advisory; the click
 * rechecks the destination and the configuration under its own checkout leases. */
export async function withPushOffer(cwd: string, tree: GitWorkingTree): Promise<GitWorkingTree> {
  if (!tree.isRepository || !tree.branch || tree.branch === DETACHED_HEAD || tree.unborn) return tree;
  try {
    const local = configuration(await runGitRead(cwd, ['config', '--local', '--no-includes', '--list', '-z']));
    // Even global-only config normally parses local configuration during startup. Disabling
    // repository discovery is essential here: unlike the click, status does not exclude writers.
    const global = configuration(await hostGit(cwd, ['--git-dir=/dev/null', ...GIT_READ_OPTIONS,
      'config', '--includes', '--list', '-z'], 8_000).catch(() => ''));
    const effective = new Map(global);
    for (const [key, values] of local) effective.set(key, [...(global.get(key) || []), ...values]);
    const plan = pushPlan(effective, tree.branch);
    if (!plan) return tree;
    if (!plan.publish) {
      // In a triangular workflow ahead/behind belongs to the fetch upstream, not the push remote.
      const ahead = tree.upstream === plan.target ? tree.ahead : Number((await runGitRead(cwd,
        ['rev-list', '--count', `refs/remotes/${plan.target}..HEAD`, '--']).catch(() => '1')).trim());
      if (!ahead) return tree;
    }
    return { ...tree, pushTarget: plan.target, publishes: plan.publish };
  } catch { return tree; }
}
