import { realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '@/server/config';
import {
  PROVIDER_CUSTOMIZATIONS, agentWritable, providerFolders, resolveUserPath,
} from '@/server/agents/globalInstructions';
import { providerFolder } from '@/server/agents/providerFolder';
import type { AgentProvider } from '@/shared/types';
import { within } from './dockerProfile';

export interface DockerCustomizations {
  /** Read-only binds, each from a canonical host path. */
  mounts: Array<{ name: string; source: string; target: string }>;
  /** Entries that exist but are not bound, each with its reason. */
  skipped: string[];
}

/** Outside the provider home volume: reference material for the worker, never its configuration. */
export function dockerCustomizationsPath(provider: AgentProvider): string {
  return `/user/${provider}`;
}

const REFUSED_BY_PATH = {
  'agent-link': 'is reached through a link an agent turn could repoint',
  protected: 'resolves to a protected folder',
  unreadable: 'cannot be read',
} as const;

/**
 * Resolves the allowlisted entries that exist, each to the canonical path Docker binds. An entry is
 * left out, with a reason, when its name could become a bind of something else: a link an agent
 * turn could repoint, a private part of a provider folder (`resolveUserPath` refuses both), a path
 * where a turn can write and could still swap a folder before Docker attaches it, any part of
 * CodeAI's data, the running installation, or Docker's and the user's configuration, as for a
 * checkout, or a folder that holds the home directory or a provider folder. An entry inside a
 * provider folder stays allowed when that folder itself lies in the user's configuration folder.
 */
export async function resolveDockerCustomizations(
  provider: AgentProvider,
  config: Pick<AppConfig, 'dataDir' | 'repositoriesRoot'>,
): Promise<DockerCustomizations> {
  const canonical = (source: string) => realpath(/* turbopackIgnore: true */ source)
    .catch(() => path.resolve(/* turbopackIgnore: true */ source));
  const [userConfiguration, ...neverAnyPart] = await Promise.all([
    path.join(os.homedir(), '.config'), config.dataDir, process.cwd(), path.join(os.homedir(), '.docker'),
  ].map(canonical));
  const providers = (await providerFolders()).map(({ folder }) => folder);
  // The configuration folder by itself too: it may be a link to somewhere the home directory does not hold.
  const neverWhole = [await canonical(os.homedir()), userConfiguration, ...providers];
  const turnCanWrite = await agentWritable(config);
  const result: DockerCustomizations = { mounts: [], skipped: [] };
  for (const entry of PROVIDER_CUSTOMIZATIONS[provider]) {
    const label = entry.kind === 'directory' ? `${entry.name}/` : entry.name;
    const resolved = await resolveUserPath(path.join(providerFolder(provider), entry.name), config);
    // A missing entry, or a link to nothing, is simply not there.
    if ('issue' in resolved) {
      if (resolved.issue !== 'missing') result.skipped.push(`${label} ${REFUSED_BY_PATH[resolved.issue]}`);
      continue;
    }
    const source = resolved.realPath;
    const info = await stat(source).catch(() => undefined);
    if (!info) continue;
    if (entry.kind === 'file' ? !info.isFile() : !info.isDirectory()) {
      result.skipped.push(`${label} is not a ${entry.kind === 'file' ? 'regular file' : 'folder'}`);
    } else if (/[,\n\r\0]/.test(source)) {
      result.skipped.push(`${label} resolves to a path Docker cannot mount`);
    } else if (turnCanWrite(source)) {
      // Docker resolves the source again when the worker starts, and nothing can prove what it bound.
      result.skipped.push(`${label} is under the repositories root or a temp directory, where an agent turn can change it`);
    } else if (neverWhole.some((folder) => within(source, folder))
      || neverAnyPart.some((folder) => within(source, folder) || within(folder, source))
      || (within(userConfiguration, source) && !providers.some((folder) => within(folder, source)))) {
      result.skipped.push(`${label} resolves to a protected folder`);
    } else {
      result.mounts.push({ name: entry.name, source, target: `${dockerCustomizationsPath(provider)}/${entry.name}` });
    }
  }
  return result;
}
