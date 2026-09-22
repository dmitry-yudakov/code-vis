import { access, chmod, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { getConfig } from '@/server/config';
import { dockerProviderHealth, getProviderAdapters } from '@/server/agents/providerRegistry';
import { safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { DOCKER_RECOVERY_MESSAGE, recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { getSessionStore } from '@/server/storage/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  const config = getConfig();
  let recoveryMessage: string | undefined;
  try { await recoverDockerExecution(config); }
  catch { recoveryMessage = DOCKER_RECOVERY_MESSAGE; }
  let repositoriesRootReady = false;
  let dataDirectoryReady = false;
  let readinessMessage: string | undefined;
  try {
    await realpath(config.repositoriesRoot);
    await access(config.repositoriesRoot, constants.R_OK);
    repositoriesRootReady = true;
  } catch {
    readinessMessage = 'Repositories root is missing or unreadable.';
  }
  try {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    await chmod(config.dataDir, 0o700);
    await access(config.dataDir, constants.R_OK | constants.W_OK);
    dataDirectoryReady = true;
  } catch {
    readinessMessage ||= 'Data directory is unavailable.';
  }
  const adapters = getProviderAdapters(config);
  const [claude, codex] = await Promise.all([
    adapters.claude.checkHealth(),
    adapters.codex.checkHealth(),
  ]);
  const providerReady = claude.available || codex.available;
  const docker = await getDockerRuntime(config).health();
  // Store failures surface where sessions load; readiness only reports what this build cannot open.
  const newerFormatSessions = dataDirectoryReady
    ? await getSessionStore(config.dataDir, config.hostLabel).newerFormatSessionCount().catch(() => 0)
    : 0;
  return safeJsonResponse({
    ok: repositoriesRootReady && dataDirectoryReady && (providerReady || docker.available) && !recoveryMessage,
    hostLabel: config.hostLabel,
    repositoriesRootReady,
    dataDirectoryReady,
    providers: { claude, codex },
    executions: {
      local: { enabled: true, providers: { claude, codex } },
      docker: {
        enabled: config.dockerEnabled,
        providers: dockerProviderHealth(config, docker, codex),
      },
    },
    newerFormatSessions,
    message: recoveryMessage || readinessMessage || (!providerReady && !docker.available ? claude.message || codex.message : undefined),
  });
}
