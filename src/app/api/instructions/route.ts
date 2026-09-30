import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getConfig, type AppConfig } from '@/server/config';
import {
  hasInstructionImports, instructionSettingsPath, readInstructionSettings, resolveGlobalInstructionFile,
} from '@/server/agents/globalInstructions';
import { authorizeDeviceRequest, requestHasExactOrigin } from '@/server/devices/deviceAuthorization';
import { resolveDockerCustomizations } from '@/server/execution/dockerCustomizations';
import { atomicWrite } from '@/server/storage/sessionStore';
import { instructionSwitchRequestSchema, safeJsonResponse } from '@/shared/protocol';
import type { AgentProvider, GlobalInstructionsView, ProviderInstructions } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything here is resolved on this machine; a request names nothing but a provider and its switch. */
async function instructionsView(config: AppConfig): Promise<GlobalInstructionsView> {
  const { damaged, ...settings } = await readInstructionSettings(config.dataDir);
  const provider = async (id: AgentProvider): Promise<{ view: ProviderInstructions; realPath?: string }> => {
    const [file, docker] = await Promise.all([resolveGlobalInstructionFile(id, config), resolveDockerCustomizations(id, config)]);
    return {
      realPath: file.realPath,
      view: {
        enabled: settings[id],
        displayPath: file.displayPath,
        ...('text' in file ? { text: file.text } : { issue: file.issue }),
        // Only Claude has imports; a file it shares with Codex says so on Claude's row.
        imports: id === 'claude' && 'text' in file && hasInstructionImports(file.text),
        ...(id === 'codex' ? { localAlways: true as const } : {}),
        ...(file.agentEditable ? { agentEditable: true as const } : {}),
        docker: { entries: docker.mounts.map((mount) => mount.name), skipped: docker.skipped },
      },
    };
  };
  const [claude, codex] = await Promise.all([provider('claude'), provider('codex')]);
  return {
    providers: { claude: claude.view, codex: codex.view },
    shared: Boolean(claude.realPath) && claude.realPath === codex.realPath,
    ...(damaged ? { damaged } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeDeviceRequest(request);
  if (denied) return denied;
  try {
    return safeJsonResponse(await instructionsView(getConfig()));
  } catch {
    return safeJsonResponse({ error: 'Could not read the global instructions on this machine.' }, { status: 503 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const denied = await authorizeDeviceRequest(request);
    if (denied) return denied;
    const config = getConfig();
    // The switch changes what every later turn on this machine is told, so it demands the exact origin.
    if (!requestHasExactOrigin(request, config)) {
      return safeJsonResponse({ error: 'Request origin is not authorized.' }, { status: 403 });
    }
    const parsed = instructionSwitchRequestSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return safeJsonResponse({ error: 'Only a provider and a boolean enabled setting are supported.' }, { status: 400 });
    }
    // A damaged record reads as off for both, so saving either switch repairs it.
    const { damaged: _damaged, ...settings } = await readInstructionSettings(config.dataDir);
    const target = instructionSettingsPath(config.dataDir);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await atomicWrite(target, { ...settings, [parsed.data.provider]: parsed.data.enabled });
    return safeJsonResponse(await instructionsView(config));
  } catch {
    return safeJsonResponse({ error: 'Could not save the global instructions setting. Check that CodeAI’s data directory is writable and try again.' }, { status: 503 });
  }
}
