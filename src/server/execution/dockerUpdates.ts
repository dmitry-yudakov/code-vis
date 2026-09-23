import { randomUUID } from 'node:crypto';
import type { AppConfig } from '@/server/config';
import { PROVIDER_LABELS } from '@/shared/participants';
import type {
  AgentProvider, DockerCliOffer, DockerUpdateOperation, DockerVersionsStatus,
} from '@/shared/types';
import { compareCliVersions, DOCKER_VERSIONS } from './dockerProfile';
import { cachedDockerReleases, dockerReleases } from './dockerReleases';
import { getDockerRuntime } from './dockerRuntime';
import {
  planDockerUpdate, readDockerVersions, runDockerUpdate, DockerUpdateRejected, type DockerVersions,
} from './dockerUpgrade';

const PROVIDERS = ['claude', 'codex'] as const;

export class DockerUpdateBusy extends Error {
  constructor() {
    super('Another Docker CLI update is running on this machine. Wait for it to finish.');
  }
}

/**
 * One update at a time in this process, run by the server rather than the browser. The last one
 * stays readable, so a reloaded Arena finds it; a CodeAI restart forgets it, and since only a
 * successful switch writes the records, an abandoned one changed nothing.
 */
const globals = globalThis as typeof globalThis & {
  __codeAiDockerUpdates?: { running: boolean; last: Map<string, DockerUpdateOperation> };
};

function updates() {
  return globals.__codeAiDockerUpdates ??= { running: false, last: new Map() };
}

/** Never the recorded version, and never below the minimum this CodeAI supports. */
function offer(version: string | undefined, recorded: string, minimum: string): DockerCliOffer | undefined {
  if (!version || version === recorded || compareCliVersions(version, minimum) < 0) return undefined;
  return { version, downgrade: compareCliVersions(version, recorded) < 0 };
}

/**
 * npm's `latest` only above the recorded version: going lower is a rollback. After a rollback,
 * `previous` is the newer version and may be the latest too: Update offers it.
 */
function offers(versions: DockerVersions, latest: Partial<Record<AgentProvider, string>> | undefined, provider: AgentProvider) {
  const minimum = DOCKER_VERSIONS[provider];
  const newer = latest?.[provider] && compareCliVersions(latest[provider], versions[provider]) > 0 ? latest[provider] : undefined;
  const latestOffer = offer(newer, versions[provider], minimum);
  const previous = versions.previous[provider];
  return {
    latest: latestOffer,
    previous: previous === latestOffer?.version ? undefined : offer(previous, versions[provider], minimum),
  };
}

export async function dockerVersionsStatus(config: AppConfig, refresh = false): Promise<DockerVersionsStatus> {
  // Copied first: a switch writes its records before it reports `switched`, so versions read
  // afterwards are never older than the outcome shown with them.
  const last = updates().last.get(config.dataDir);
  const operation = last && { ...last };
  const [versions, releases] = await Promise.all([readDockerVersions(getDockerRuntime(config)), dockerReleases(refresh)]);
  const providers = Object.fromEntries(PROVIDERS.map((provider) => {
    const { latest, previous } = offers(versions, releases.latest, provider);
    return [provider, {
      version: versions[provider], minimum: DOCKER_VERSIONS[provider],
      ...(latest ? { latest } : {}), ...(previous ? { previous } : {}),
    }];
  })) as DockerVersionsStatus['providers'];
  return {
    providers,
    releases: { checkedAt: new Date(releases.checkedAt).toISOString(), ...(releases.latest ? {} : { failed: true as const }) },
    ...(operation ? { operation } : {}),
  };
}

/**
 * Resolves `target` from the server's own lookup or versions record, refuses anything an update
 * would refuse, and then builds, checks and switches in the background.
 */
export async function startDockerUpdate(
  config: AppConfig, request: { provider: AgentProvider; target: 'latest' | 'previous' },
): Promise<DockerUpdateOperation> {
  const state = updates();
  const runtime = getDockerRuntime(config);
  const label = PROVIDER_LABELS[request.provider];
  if (state.running) throw new DockerUpdateBusy();
  state.running = true;
  let plan: Awaited<ReturnType<typeof planDockerUpdate>>;
  try {
    const versions = await readDockerVersions(runtime);
    // Never a new lookup: Update starts only what Arena offered from the answer it showed.
    const releases = request.target === 'latest' ? cachedDockerReleases() : undefined;
    if (request.target === 'latest' && !releases) throw new DockerUpdateRejected('Check for updates again first.');
    const offered = offers(versions, releases?.latest, request.provider)[request.target];
    if (!offered) {
      throw new DockerUpdateRejected(request.target === 'previous' ? `${label} has no previous version to roll back to.`
        : releases?.latest ? `There is no newer ${label} release to update to.` : 'Couldn’t check for updates.');
    }
    plan = await planDockerUpdate(runtime, request.provider, offered.version);
  } catch (error) {
    state.running = false;
    throw error;
  }
  const operation: DockerUpdateOperation = {
    id: randomUUID(), provider: request.provider, version: plan.version, state: 'building', startedAt: new Date().toISOString(),
  };
  state.last.set(config.dataDir, operation);
  void runDockerUpdate(runtime, plan, (step) => { operation.state = step; })
    .then((result) => {
      operation.state = result.outcome;
      operation.message = result.outcome === 'switched'
        ? [`${label} ${result.version} replaced ${result.replaced}. New turns use it.`, plan.warning].filter(Boolean).join(' ')
        : result.message;
      if (result.outcome === 'failed' && result.check) operation.check = result.check;
    }, () => {
      // runDockerUpdate reports its own failures; this is Docker access failing before it began.
      operation.state = 'failed';
      operation.message = 'The update failed. Check Docker and the CodeAI Docker setup guide.';
    })
    .finally(() => {
      operation.finishedAt = new Date().toISOString();
      state.running = false;
    });
  return { ...operation };
}
