import { boundedResponseText } from '@/server/machines/machineClient';
import type { AgentProvider } from '@/shared/types';
import { isCliVersion } from './dockerProfile';

const PACKAGES: Record<AgentProvider, string> = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' };
export const DOCKER_RELEASES_TTL_MS = 60 * 60_000;
const LOOKUP_TIMEOUT_MS = 10_000;
const MAX_DIST_TAGS_BYTES = 65_536;

/** What npm answered at `checkedAt`; no `latest` means that lookup failed. */
export interface DockerReleases {
  checkedAt: number;
  latest?: Record<AgentProvider, string>;
}

const globals = globalThis as typeof globalThis & {
  __codeAiDockerReleases?: { answer?: DockerReleases; pending?: Promise<DockerReleases> };
};

async function latestVersion(provider: AgentProvider): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/-/package/${PACKAGES[provider].replace('/', '%2f')}/dist-tags`, {
    cache: 'no-store',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`npm answered ${response.status}.`);
  const latest = (JSON.parse(await boundedResponseText(response, MAX_DIST_TAGS_BYTES)) as { latest?: unknown }).latest;
  if (typeof latest !== 'string' || !isCliVersion(latest)) throw new Error('npm reported no exact latest version.');
  return latest;
}

/** The answer Arena last showed, while it is still fresh. */
export function cachedDockerReleases(): DockerReleases | undefined {
  const answer = globals.__codeAiDockerReleases?.answer;
  return answer && Date.now() - answer.checkedAt < DOCKER_RELEASES_TTL_MS ? answer : undefined;
}

/**
 * Each provider's npm `latest`, looked up only when Arena asks and kept for one hour, a failed
 * lookup included. `refresh` is Check for updates.
 */
export function dockerReleases(refresh = false): Promise<DockerReleases> {
  const cache = globals.__codeAiDockerReleases ??= {};
  if (cache.pending) return cache.pending;
  const fresh = cachedDockerReleases();
  if (!refresh && fresh) return Promise.resolve(fresh);
  cache.pending = Promise.all([latestVersion('claude'), latestVersion('codex')])
    .then(([claude, codex]): DockerReleases => ({ checkedAt: Date.now(), latest: { claude, codex } }))
    .catch((): DockerReleases => ({ checkedAt: Date.now() }))
    .then((answer) => {
      cache.answer = answer;
      cache.pending = undefined;
      return answer;
    });
  return cache.pending;
}
