import { access, chmod, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { getConfig } from '@/server/config';
import { instructionsReadiness } from '@/server/agents/globalInstructions';
import { dockerProviderHealth, getProviderAdapters } from '@/server/agents/providerRegistry';
import { safeJsonResponse } from '@/shared/protocol';
import { authorizeDeviceRequest } from '@/server/devices/deviceAuthorization';
import { getDockerRuntime } from '@/server/execution/dockerRuntime';
import { getCodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';
import { recordedCodexModels } from '@/server/execution/dockerUpgrade';
import { DOCKER_RECOVERY_MESSAGE, recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { getSessionStore } from '@/server/storage/sessionStore';
import type { ProviderHealth } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withNote(health: ProviderHealth, note: string | undefined): ProviderHealth {
  return note ? { ...health, message: [health.message, note].filter(Boolean).join(' ') } : health;
}

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
  const [localClaude, codex, instructions] = await Promise.all([
    adapters.claude.checkHealth(),
    adapters.codex.checkHealth(),
    instructionsReadiness(config),
  ]);
  // Local Codex loads its own global file, so an instructions line is only ever about Claude or Docker.
  const claude = withNote(localClaude, instructions.notes.claude);
  const providerReady = claude.available || codex.available;
  const docker = await getDockerRuntime(config).health();
  const dockerProviders = dockerProviderHealth(config, docker, codex, await recordedCodexModels(config));
  // Store failures surface where sessions load; readiness only reports what this build cannot open.
  const newerFormatSessions = dataDirectoryReady
    ? await getSessionStore(config.dataDir, config.hostLabel).newerFormatSessionCount().catch(() => 0)
    : 0;
  const lifecycle = getCodeAiLifecycle();
  return safeJsonResponse({
    ok: repositoriesRootReady && dataDirectoryReady && (providerReady || docker.available) && !recoveryMessage,
    hostLabel: config.hostLabel,
    securityLevel: config.securityLevel,
    repositoriesRootReady,
    dataDirectoryReady,
    providers: { claude, codex },
    executions: {
      local: { enabled: true, providers: { claude, codex } },
      docker: {
        enabled: config.dockerEnabled,
        providers: {
          claude: withNote(dockerProviders.claude, docker.available ? instructions.notes.claude : undefined),
          codex: withNote(dockerProviders.codex, docker.available ? instructions.notes.codex : undefined),
        },
      },
    },
    // This machine's switches and files, so a session can show what its next turn gets.
    instructions: instructions.instructions,
    newerFormatSessions,
    // Which build serves this response, for a browser reconnecting after a managed restart.
    // Nothing above depends on it.
    release: lifecycle?.managed ? { managed: true, releaseId: lifecycle.releaseId } : { managed: false },
    message: recoveryMessage || readinessMessage || (!providerReady && !docker.available ? claude.message || codex.message : undefined),
  });
}
