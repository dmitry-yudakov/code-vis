import os from 'node:os';
import path from 'node:path';
import type { AgentProvider } from '@/shared/types';

const FOLDER_VARIABLE: Record<AgentProvider, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const DEFAULT_FOLDER: Record<AgentProvider, string> = { claude: '.claude', codex: '.codex' };

/** The provider's folder in the home directory, which holds its private files even when a variable names another. */
export function defaultProviderFolder(provider: AgentProvider): string {
  return path.join(/* turbopackIgnore: true */ os.homedir(), DEFAULT_FOLDER[provider]);
}

/**
 * Where the provider keeps the user's own configuration on this machine: its variable when that is
 * an absolute path, else its folder in the home directory. A relative value makes either CLI use a
 * folder under the turn's working directory, which is repository content and never read as the
 * user's own.
 */
export function providerFolder(provider: AgentProvider): string {
  const configured = process.env[FOLDER_VARIABLE[provider]];
  return configured && path.isAbsolute(configured) ? path.normalize(configured) : defaultProviderFolder(provider);
}
