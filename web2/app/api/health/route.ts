import { access, chmod, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { getConfig } from '@/lib/server/config';
import { getProviderAdapters } from '@/lib/server/providerRegistry';
import { safeJsonResponse } from '@/lib/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const config = getConfig();
  let projectsRootReady = false;
  let dataDirectoryReady = false;
  let readinessMessage: string | undefined;
  try {
    await realpath(config.projectsRoot);
    await access(config.projectsRoot, constants.R_OK);
    projectsRootReady = true;
  } catch {
    readinessMessage = 'Projects root is missing or unreadable.';
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
  return safeJsonResponse({
    ok: projectsRootReady && dataDirectoryReady && providerReady,
    projectsRootReady,
    dataDirectoryReady,
    providers: { claude, codex },
    message: readinessMessage || (!providerReady ? claude.message || codex.message : undefined),
  });
}
