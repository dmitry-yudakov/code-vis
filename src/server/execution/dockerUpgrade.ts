import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { inspectClaudeHelp } from '@/server/agents/claudePreflight';
import { checkCodexWorker } from '@/server/agents/codexPreflight';
import { atomicWrite } from '@/server/storage/sessionStore';
import { MAX_MODEL_EFFORTS, MAX_PROVIDER_MODELS } from '@/shared/limits';
import { providerModelSchema } from '@/shared/machineSchema';
import { PROVIDER_LABELS } from '@/shared/participants';
import { agentEffortSchema } from '@/shared/protocol';
import type { AgentProvider, ModelChoices } from '@/shared/types';
import { dockerCommand, localDockerEndpoint, spawnDocker, DockerCommandError } from './dockerCommand';
import {
  compareCliVersions, containerSecurity, installationImageTag, isCliVersion, DOCKER_HOME, DOCKER_PATH, DOCKER_VERSIONS,
} from './dockerProfile';
import {
  DockerHomeBusyError, DockerProfileChangedError, DockerProfileError, replaceDockerImage, type DockerRuntime,
} from './dockerRuntime';

const PROVIDERS = ['claude', 'codex'] as const;
type CliVersions = Record<AgentProvider, string>;
/** A new container per check ends itself if CodeAI is gone before removing it. */
const CHECK_LIFETIME_SECONDS = 300;
const CHECK_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;

const cliVersionSchema = z.string().refine(isCliVersion);
/** Not strict: a newer CodeAI may add a field, and this one keeps reading the rest. */
const versionsSchema = z.object({
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  claude: cliVersionSchema,
  codex: cliVersionSchema,
  previous: z.object({ claude: cliVersionSchema.optional(), codex: cliVersionSchema.optional() }),
  codexModels: z.object({
    models: z.array(providerModelSchema).max(MAX_PROVIDER_MODELS).optional(),
    efforts: z.array(agentEffortSchema).max(MAX_MODEL_EFFORTS).optional(),
  }).optional(),
});

/**
 * `<dataDir>/docker/versions.json`, separate from profile.json so that a CodeAI predating it keeps
 * reading the profile. It describes one image: its CLIs, the version each update replaced, and that
 * image's own Codex model list.
 */
export type DockerVersions = z.infer<typeof versionsSchema>;

export function dockerVersionsPath(dataDir: string): string {
  return path.join(dataDir, 'docker', 'versions.json');
}

/** An update refused before anything was built. */
export class DockerUpdateRejected extends Error {}

const NOT_PROVISIONED = 'This installation is not provisioned for Docker. Run npm run docker:provision first.';

/** Only CodeAI's own Docker messages leave the server: a file-system or parse error may name paths or contents. */
function dockerMessage(error: unknown, fallback: string): string {
  return error instanceof DockerProfileError || error instanceof DockerProfileChangedError || error instanceof DockerCommandError
    ? error.message : fallback;
}

export type DockerUpdateStep = 'building' | 'checking' | 'switching';
export type DockerCheck = 'build' | 'version' | 'claude-flags' | 'codex-handshake' | 'codex-models';
export type DockerUpdateResult =
  | { outcome: 'switched'; provider: AgentProvider; version: string; replaced: string }
  | { outcome: 'failed'; check?: DockerCheck; message: string }
  | { outcome: 'in-use'; message: string };

export interface DockerUpdatePlan {
  provider: AgentProvider;
  version: string;
  /** The recorded image the candidate starts from. The switch refuses once profile.json names another. */
  image: string;
  recorded: DockerVersions;
  warning?: string;
}

type DockerAccess = { runtime: DockerRuntime; endpoint: string; command: (args: string[]) => Promise<string> };

async function dockerAccess(runtime: DockerRuntime): Promise<DockerAccess> {
  const endpoint = await localDockerEndpoint();
  return { runtime, endpoint, command: (args) => dockerCommand(['--host', endpoint, ...args]) };
}

/** The fixed build context is CodeAI's own `docker/` directory, never a session checkout. */
export function dockerBuildContext(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'docker');
}

/** The Dockerfile has no default versions: every build names both. */
export function dockerBuildArguments(versions: CliVersions): string[] {
  return PROVIDERS.flatMap((provider) => ['--build-arg', `${provider.toUpperCase()}_VERSION=${versions[provider]}`]);
}

/**
 * A new container from `image` with CodeAI's container security, no network, no mounts, and a
 * throwaway home that disappears with it: no provider home, checkout or CodeAI data is reachable.
 * It removes itself when its sleep ends, so startup recovery leaves it to the process using it.
 */
async function inCheckContainer<T>(access: DockerAccess, image: string, use: (container: string) => Promise<T>): Promise<T> {
  const container = (await access.command([
    'create', '--rm', ...access.runtime.labels('check'), ...containerSecurity(1000, 1000), '--network', 'none',
    '--tmpfs', `${DOCKER_HOME}:rw,nosuid,nodev,size=64m,mode=1777`,
    '--env', `HOME=${DOCKER_HOME}`, '--env', `PATH=${DOCKER_PATH}`, '--env', 'LANG=C.UTF-8', '--workdir', DOCKER_HOME,
    image, 'sleep', String(CHECK_LIFETIME_SECONDS),
  ])).trim();
  try {
    await access.command(['start', container]);
    return await use(container);
  } finally {
    // Best effort: it holds nothing and ends itself; startup recovery removes one whose process died.
    await access.command(['container', 'rm', '--force', container]).catch(() => undefined);
  }
}

function reportedVersion(output: string): string | undefined {
  const version = output.match(/(?:^|\s)(\d+\.\d+\.\d+)(?=\s|$)/)?.[1];
  return version && isCliVersion(version) ? version : undefined;
}

async function imageVersions(access: DockerAccess, image: string): Promise<Partial<CliVersions>> {
  return inCheckContainer(access, image, async (container) => {
    const reported: Partial<CliVersions> = {};
    for (const provider of PROVIDERS) {
      reported[provider] = reportedVersion(await access.command(['exec', container, provider, '--version']).catch(() => ''));
    }
    return reported;
  });
}

/** An image's CLIs never change, so a stale record's versions are read once per runtime. */
const staleReads = new WeakMap<DockerRuntime, Map<string, CliVersions>>();

/** An absent, unreadable or invalid record is no record: callers treat it as stale. */
function readVersionsRecord(dataDir: string): Promise<DockerVersions | undefined> {
  return readFile(dockerVersionsPath(dataDir), 'utf8').then((source) => versionsSchema.parse(JSON.parse(source))).catch(() => undefined);
}

async function versionsOf(runtime: DockerRuntime, image: string, access?: DockerAccess): Promise<DockerVersions> {
  const record = await readVersionsRecord(runtime.config.dataDir);
  if (record?.image === image) return record;
  // Stale: provisioned before this record existed, or a switch stopped between its two writes.
  const cache = staleReads.get(runtime) ?? new Map<string, CliVersions>();
  staleReads.set(runtime, cache);
  let versions = cache.get(image);
  if (!versions) {
    const reported = await imageVersions(access ?? await dockerAccess(runtime), image);
    if (!reported.claude || !reported.codex) throw new Error('The recorded Docker image does not report its CLI versions.');
    versions = { claude: reported.claude, codex: reported.codex };
    cache.set(image, versions);
  }
  return { image, ...versions, previous: {} };
}

/** The versions of the image profile.json records. */
export async function readDockerVersions(runtime: DockerRuntime): Promise<DockerVersions> {
  const { image } = await runtime.provision().catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? new DockerUpdateRejected(NOT_PROVISIONED) : error;
  });
  return versionsOf(runtime, image);
}

export async function writeDockerVersions(dataDir: string, versions: DockerVersions): Promise<void> {
  await atomicWrite(dockerVersionsPath(dataDir), versionsSchema.parse(versions));
}

/** Everything an update can refuse is refused here, before anything is built. */
export async function planDockerUpdate(runtime: DockerRuntime, provider: string, version: string): Promise<DockerUpdatePlan> {
  if (provider !== 'claude' && provider !== 'codex') throw new DockerUpdateRejected('Name the provider to update: claude or codex.');
  const label = PROVIDER_LABELS[provider];
  const minimum = DOCKER_VERSIONS[provider];
  if (!isCliVersion(version)) {
    throw new DockerUpdateRejected(`Name an exact version of ${label}, such as ${minimum}. Ranges, tags and pre-releases are not accepted.`);
  }
  if (compareCliVersions(version, minimum) < 0) {
    throw new DockerUpdateRejected(`${label} ${version} is not supported: this CodeAI needs at least ${minimum}.`);
  }
  let profile: Awaited<ReturnType<DockerRuntime['recordedProfile']>>;
  try { profile = await runtime.recordedProfile(); }
  catch (error) {
    throw new DockerUpdateRejected((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? NOT_PROVISIONED : dockerMessage(error, 'CodeAI could not read its Docker profile.'));
  }
  const recorded = await versionsOf(runtime, profile.image, { runtime, endpoint: profile.endpoint, command: profile.command });
  if (recorded[provider] === version) throw new DockerUpdateRejected(`${label} ${version} is already the recorded version.`);
  const warning = compareCliVersions(version, recorded[provider]) < 0
    ? `${label} ${version} is older than the recorded ${recorded[provider]}. The newer CLI may already have migrated ${label}’s shared Docker home, so watch the first turn after switching.`
    : undefined;
  return { provider, version, image: profile.image, recorded, ...(warning ? { warning } : {}) };
}

/**
 * Unrecorded, under a tag of its own, so nothing live changes until the switch. The build cache
 * reproduces an identical image for the same versions, which a concurrent update or another
 * installation may record: removing the candidate by its tag deletes the image only when nothing
 * else references it, where removing it by ID would not ask.
 */
async function buildCandidate(access: DockerAccess, versions: CliVersions, tag: string): Promise<string> {
  const output = await dockerCommand(['--host', access.endpoint, 'build', '--load', '--quiet', '--tag', tag,
    ...dockerBuildArguments(versions), dockerBuildContext()], { timeout: BUILD_TIMEOUT_MS });
  const built = output.match(/sha256:[a-f0-9]{64}/g)?.at(-1);
  if (!built) throw new Error('Docker did not report the candidate image.');
  return (await access.command(['image', 'inspect', built, '--format', '{{.Id}}'])).trim();
}

export type DockerImageCheck =
  | { passed: true; codexModels: ModelChoices }
  | { passed: false; check: Exclude<DockerCheck, 'build'>; message: string };

/**
 * Offline checks of what CodeAI relies on. They sign nobody in and call no model, so they cannot see
 * a changed event stream, network host or login flow; those surface on the first real turn.
 */
export async function checkDockerImage(runtime: DockerRuntime, image: string, expected: CliVersions): Promise<DockerImageCheck> {
  return checkImage(await dockerAccess(runtime), image, expected);
}

async function checkImage(access: DockerAccess, image: string, expected: CliVersions): Promise<DockerImageCheck> {
  const reported = await imageVersions(access, image);
  for (const provider of PROVIDERS) {
    if (reported[provider] !== expected[provider]) {
      return { passed: false, check: 'version', message: reported[provider]
        ? `${provider} --version reports ${reported[provider]}, not ${expected[provider]}.`
        : `${provider} --version does not report a version.` };
    }
  }
  const help = await inCheckContainer(access, image, (container) => access.command(['exec', container, 'claude', '--help']))
    .catch(() => undefined);
  if (help === undefined) return { passed: false, check: 'claude-flags', message: 'claude --help failed.' };
  const { missingByMode, effortSupported } = inspectClaudeHelp(help);
  const missing = [...new Set([...missingByMode.flatMap((entry) => entry.missing), ...(effortSupported ? [] : ['--effort'])])];
  if (missing.length) {
    return { passed: false, check: 'claude-flags', message: `claude --help does not document ${missing.join(', ')}, which CodeAI requires.` };
  }
  const codex = await inCheckContainer(access, image, (container) => checkCodexWorker('codex', DOCKER_HOME, {
    spawn: (binary, args) => spawnDocker(access.endpoint, ['exec', '-i', container, binary, ...args]),
    timeoutMs: CHECK_TIMEOUT_MS,
  }));
  return codex.passed ? { passed: true, codexModels: codex.choices } : codex;
}

/**
 * Builds a candidate with `plan.version` for one provider and the recorded version for the other,
 * checks it, and switches to it under that provider's setup hold. Only the switch writes a record,
 * and an unrecorded candidate is removed.
 */
export async function runDockerUpdate(
  runtime: DockerRuntime, plan: DockerUpdatePlan, onStep?: (step: DockerUpdateStep) => void,
): Promise<DockerUpdateResult> {
  const access = await dockerAccess(runtime);
  const label = PROVIDER_LABELS[plan.provider];
  const target = { claude: plan.recorded.claude, codex: plan.recorded.codex, [plan.provider]: plan.version };
  const switched = { outcome: 'switched' as const, provider: plan.provider, version: plan.version, replaced: plan.recorded[plan.provider] };
  onStep?.('building');
  const tag = `codeai-worker:candidate-${randomUUID()}`;
  let candidate: { image: string; tag: string };
  try { candidate = { image: await buildCandidate(access, target, tag), tag }; }
  catch {
    // A build may have finished and tagged its image before its answer could not be read.
    await access.command(['image', 'rm', tag]).catch(() => undefined);
    return { outcome: 'failed', check: 'build', message: `The candidate image could not be built. Check that ${label} ${plan.version} is published on npm and that Docker can reach the registry.` };
  }
  let recorded = false;
  try {
    onStep?.('checking');
    const checked = await checkImage(access, candidate.image, target);
    if (!checked.passed) return { outcome: 'failed', check: checked.check, message: checked.message };
    const versions = versionsSchema.parse({
      image: candidate.image, ...target,
      previous: { ...plan.recorded.previous, [plan.provider]: plan.recorded[plan.provider] },
      codexModels: checked.codexModels,
    });
    onStep?.('switching');
    await runtime.holdProviderHome(plan.provider, async () => {
      await replaceDockerImage(runtime.config.dataDir, plan.image, candidate.image);
      // The switch is done. A failure below leaves a stale record, which is read again from the image.
      recorded = true;
      await atomicWrite(dockerVersionsPath(runtime.config.dataDir), versions);
      // This installation's own tag keeps its recorded image from counting as dangling. The shared
      // tag stays where provisioning put it: another installation's recorded image may rely on it.
      // The previous image loses this tag and stays in Docker for turns already running in it.
      await access.command(['tag', candidate.image, installationImageTag(runtime.owner)]);
      await access.command(['image', 'rm', candidate.tag]);
    });
    return switched;
  } catch (error) {
    // A write can fail after its rename, so profile.json, not the flag, says whether it switched.
    recorded ||= (await runtime.provision().catch(() => undefined))?.image === candidate.image;
    if (recorded) return switched;
    if (error instanceof DockerHomeBusyError) {
      // A setup hold is a login's or another update's; a turn holds admission or mounts the home.
      const holder = error.holder === 'turn' ? 'a turn' : 'a login or another update';
      return { outcome: 'in-use', message: `${label} is in use by ${holder}. Try again when it finishes.` };
    }
    return { outcome: 'failed', message: dockerMessage(error, 'The update failed. Check Docker and the CodeAI Docker setup guide.') };
  } finally {
    if (!recorded) await access.command(['image', 'rm', candidate.tag]).catch(() => undefined);
  }
}
