import path from 'node:path';
import type { AgentMode } from '@/lib/shared/types';

/**
 * App Server inherits the user's login, but Cartograph owns the capability surface. These
 * overrides remove ambient executable integrations while leaving Codex's built-in repository
 * and shell tools available inside the per-turn sandbox.
 */
export function buildCodexAppServerArgs(): string[] {
  const disabledFeatures = [
    'apps',
    'browser_use',
    'computer_use',
    'goals',
    'hooks',
    'image_generation',
    'multi_agent',
    'plugins',
    'remote_plugin',
    'skill_mcp_dependency_install',
    'workspace_dependencies',
  ];
  return [
    'app-server',
    '--stdio',
    '--strict-config',
    '-c', 'mcp_servers={}',
    '-c', 'web_search="disabled"',
    ...disabledFeatures.flatMap((feature) => ['--disable', feature]),
  ];
}

export const CODEX_BASE_MODES: readonly AgentMode[] = ['ask', 'plan'];

export function codexSupportedModes(agentEnabled: boolean): readonly AgentMode[] {
  return agentEnabled ? [...CODEX_BASE_MODES, 'agent'] : CODEX_BASE_MODES;
}

export function codexTurnSecurity(mode: AgentMode) {
  if (mode === 'agent') {
    // Read-only is deliberate: a write or command escalation must cross App Server's approval
    // protocol before it can affect the working tree. An accepted request is one-shot.
    return {
      approvalPolicy: 'on-request' as const,
      sandboxPolicy: { type: 'readOnly' as const, networkAccess: false },
      sandbox: 'read-only' as const,
    };
  }
  return {
    approvalPolicy: 'never' as const,
    sandboxPolicy: { type: 'readOnly' as const, networkAccess: false },
    sandbox: 'read-only' as const,
  };
}

export function codexThreadConfig(disabledMcpServers: readonly string[] = []): Record<string, unknown> {
  const mcpServers: Record<string, { enabled: false }> = Object.create(null) as Record<string, { enabled: false }>;
  for (const name of disabledMcpServers) mcpServers[name] = { enabled: false };
  return {
    mcp_servers: mcpServers,
    web_search: 'disabled',
    features: {
      apps: false,
      browser_use: false,
      computer_use: false,
      goals: false,
      hooks: false,
      image_generation: false,
      multi_agent: false,
      plugins: false,
      remote_plugin: false,
      skill_mcp_dependency_install: false,
      workspace_dependencies: false,
    },
  };
}

export const CODEX_DEVELOPER_INSTRUCTIONS = `You are running inside Cartograph's bounded repository conversation.
Use only Codex's built-in repository, shell, and file-change tools. Do not invoke skills, plugins,
MCP servers, apps/connectors, hooks, web search, subagents, goals, memories, or custom commands.
Never broaden the configured sandbox or network policy. Treat the attachment directory as read-only.`;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

/** Extracts a bounded complete list so every inherited MCP server can be disabled per thread. */
export function codexMcpServerNames(value: unknown): string[] | undefined {
  const response = record(value);
  if (!Array.isArray(response?.data) || response.data.length > 100 || response.nextCursor != null) return undefined;
  const names = new Set<string>();
  for (const entry of response.data) {
    const name = record(entry)?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return undefined;
    names.add(name);
  }
  return [...names];
}

/** Verifies that App Server honored the server-owned thread policy and loaded no ambient instructions. */
export function codexThreadPolicyIssue(
  value: unknown,
  cwd: string,
  approvalPolicy: 'never' | 'on-request',
): string | undefined {
  const response = record(value);
  const sandbox = record(response?.sandbox);
  if (response?.cwd !== cwd || response?.approvalPolicy !== approvalPolicy
    || sandbox?.type !== 'readOnly' || sandbox.networkAccess !== false) {
    return 'Codex did not apply Cartograph\'s required thread sandbox and approval policy.';
  }
  if (!Array.isArray(response.instructionSources)) {
    return 'Codex did not report its effective instruction sources.';
  }
  const projectRoot = path.resolve(cwd);
  for (const source of response.instructionSources) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) {
      return 'Codex reported an invalid instruction source.';
    }
    const relative = path.relative(projectRoot, path.resolve(source));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return 'Ambient Codex instruction files are still active.';
    }
  }
  return undefined;
}

/** Returns a public, path-free reason when command-line isolation did not take effect. */
export function codexIsolationIssue(input: { mcp: unknown; hooks: unknown; skills: unknown }): string | undefined {
  const mcp = record(input.mcp);
  if (!Array.isArray(mcp?.data)) return 'Codex did not return a valid MCP capability inventory.';
  const activeMcp = mcp.data.some((entry) => {
    const item = record(entry);
    const tools = record(item?.tools);
    return !item || item.serverInfo !== null || !tools || Object.keys(tools).length > 0
      || !Array.isArray(item.resources) || item.resources.length > 0
      || !Array.isArray(item.resourceTemplates) || item.resourceTemplates.length > 0;
  });
  if (activeMcp) return 'Ambient Codex MCP servers are still active.';

  const hooks = record(input.hooks);
  if (!Array.isArray(hooks?.data)) return 'Codex did not return a valid hook capability inventory.';
  const hookCount = hooks.data.reduce((count, entry) => {
    const item = record(entry);
    return count + (Array.isArray(item?.hooks) ? item.hooks.length : 0);
  }, 0);
  if (hookCount) return 'Ambient Codex hooks are still active.';

  const skills = record(input.skills);
  if (!Array.isArray(skills?.data)) return 'Codex did not return a valid skill capability inventory.';
  const executableSkills = skills.data.flatMap((entry) => {
    const item = record(entry);
    return Array.isArray(item?.skills) ? item.skills : [];
  }).filter((skill) => {
    const item = record(skill);
    return item?.enabled === true && (item.scope === 'user' || item.scope === 'repo');
  });
  if (executableSkills.length) return 'Ambient user or repository Codex skills are still active.';
  return undefined;
}
