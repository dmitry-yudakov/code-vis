import path from 'node:path';
import { MAX_PROVIDER_MODELS } from '@/shared/limits';
import { providerModelSchema } from '@/shared/machineSchema';
import type { AgentExecution, AgentMode, ModelChoices, ProviderModel, SecurityLevel } from '@/shared/types';

/**
 * Features CodeAI turns off for Guarded turns. The last two would let a turn ask for a permission
 * profile covering the whole turn; CodeAI's cards grant one action.
 */
const CODEX_DISABLED_FEATURES = [
  'apps',
  'browser_use',
  'computer_use',
  'goals',
  'hooks',
  'image_generation',
  'plugins',
  'remote_plugin',
  'skill_mcp_dependency_install',
  'workspace_dependencies',
  'request_permissions_tool',
  'exec_permission_approvals',
] as const;
const TURN_PERMISSION_FEATURES = ['request_permissions_tool', 'exec_permission_approvals'] as const;

/**
 * App Server inherits the user's login, but CodeAI owns the capability surface. These
 * overrides remove ambient executable integrations while leaving Codex's built-in repository
 * and shell tools available inside the per-turn sandbox.
 */
export function buildCodexAppServerArgs(level: SecurityLevel = 'guarded'): string[] {
  return [
    'app-server',
    '--stdio',
    '--strict-config',
    ...(level === 'native' ? [] : ['-c', 'mcp_servers={}', '-c', 'web_search="disabled"']),
    ...(level === 'native' ? [] : ['--enable', 'multi_agent']),
    ...(level === 'native' ? TURN_PERMISSION_FEATURES : CODEX_DISABLED_FEATURES).flatMap((feature) => ['--disable', feature]),
  ];
}

/** A model-free check that the workspace sandbox can start here: `true`, run inside it. */
export function buildCodexSandboxCheckArgs(): string[] {
  return ['sandbox', '-c', 'sandbox_mode="workspace-write"', '--', 'true'];
}

export const CODEX_BASE_MODES: readonly AgentMode[] = ['ask', 'plan'];

/** Agent and Auto share one release gate: Auto's escalations use the approval path Agent's gate protects. */
export function codexSupportedModes(agentEnabled: boolean, level: SecurityLevel = 'guarded'): readonly AgentMode[] {
  return [...CODEX_BASE_MODES, ...(agentEnabled ? ['agent', 'auto'] as const : []), ...(level === 'native' ? ['full'] as const : [])];
}

const CODEX_AUTO_PROFILE_ID = 'codeai-auto';

/**
 * Auto's sandbox, as a Codex permission profile. `:workspace` makes the checkout writable, keeps
 * `.git` and `.codex` at its root read-only, and leaves `/tmp` writable for tools. It does not
 * protect `.claude`, so that entry is CodeAI's. Writes anywhere else, and all network, leave the
 * profile and therefore ask. A directory of the same name deeper in the checkout is not protected:
 * a profile can only deny a glob outright, which would also hide the root `.git` from reads. See
 * "Story 79 — Auto probes" in docs/experiment-log.md.
 */
export const CODEX_AUTO_PROFILE = Object.freeze({
  extends: ':workspace',
  filesystem: Object.freeze({ ':workspace_roots': Object.freeze({ '.': 'write', '.claude': 'read' }) }),
  network: Object.freeze({ enabled: false }),
});

/** What one turn asks App Server to enforce, and what the thread echo is checked against. */
export interface CodexTurnSecurity {
  approvalPolicy: 'never' | 'on-request';
  /** Sent at `turn/start`. Absent with a permission profile, which a legacy policy would replace. */
  sandboxPolicy?:
    | { type: 'readOnly'; networkAccess: false }
    | { type: 'externalSandbox'; networkAccess: 'restricted' };
  /**
   * Sent at `thread/start` and `thread/resume`; the thread echoes the policy it resolved to. Absent
   * with a permission profile: App Server drops the profile when a legacy mode is named beside it.
   */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * Who answers an escalation. Named only for `on-request`: a `never` turn raises no approval, so it
   * neither sends nor checks a reviewer. Codex otherwise takes it from the user's own config, where
   * `auto_review` would hand CodeAI's cards to a model.
   */
  approvalsReviewer?: 'user';
  /** Auto only: the profile `codexThreadConfig` defines and selects for the thread. */
  permissionProfile?: typeof CODEX_AUTO_PROFILE_ID;
}

export function codexTurnSecurity(mode: AgentMode, execution: AgentExecution = 'local', level: SecurityLevel = 'guarded'): CodexTurnSecurity {
  if (execution === 'docker') return {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' },
    sandbox: 'danger-full-access',
  };
  if (level === 'native') {
    if (mode === 'auto') return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
    if (mode === 'full') return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    if (mode === 'agent') return { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
  }
  if (mode === 'auto') return { approvalPolicy: 'on-request', approvalsReviewer: 'user', permissionProfile: CODEX_AUTO_PROFILE_ID };
  if (mode === 'agent') {
    // Read-only is deliberate: a write or command escalation must cross App Server's approval
    // protocol before it can affect the working tree. An accepted request is one-shot.
    return {
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      sandbox: 'read-only',
      approvalsReviewer: 'user',
    };
  }
  return {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    sandbox: 'read-only',
  };
}

export function codexThreadConfig(
  disabledMcpServers: readonly string[] = [],
  security?: Pick<CodexTurnSecurity, 'permissionProfile'>,
  level: SecurityLevel = 'guarded',
): Record<string, unknown> {
  if (level === 'native') return { features: Object.fromEntries(TURN_PERMISSION_FEATURES.map((feature) => [feature, false])) };
  const mcpServers: Record<string, { enabled: false }> = Object.create(null) as Record<string, { enabled: false }>;
  for (const name of disabledMcpServers) mcpServers[name] = { enabled: false };
  return {
    mcp_servers: mcpServers,
    web_search: 'disabled',
    features: { ...Object.fromEntries(CODEX_DISABLED_FEATURES.map((feature) => [feature, false])), multi_agent: true },
    ...(security?.permissionProfile ? {
      default_permissions: security.permissionProfile,
      permissions: { [security.permissionProfile]: CODEX_AUTO_PROFILE },
    } : {}),
  };
}

const CODEX_INSTRUCTIONS_HEAD = `You are running inside CodeAI's bounded repository conversation.
Use only Codex's built-in repository, shell, file-change tools, and built-in subagents.
Use subagents when the user or applicable repository instructions request delegation or review.
Subagents inherit this turn's permissions and must stay within its task and execution limits.
Wait for their results and close them before finishing; summarize their findings in your own answer.
Do not invoke skills, plugins, MCP servers, apps/connectors, hooks, web search, goals, memories, or custom commands.`;

const CODEX_DEVELOPER_INSTRUCTIONS = `${CODEX_INSTRUCTIONS_HEAD}
Never broaden the configured sandbox or network policy. Treat the attachment directory as read-only.`;

/**
 * Auto's own instructions. With the text above, a real turn reported a blocked commit and stopped;
 * told to ask for one action, it raised one approval request. `.claude` is named because the
 * sandbox shows a missing one as an empty untracked placeholder, which a turn tried to commit.
 */
const CODEX_AUTO_DEVELOPER_INSTRUCTIONS = `${CODEX_INSTRUCTIONS_HEAD}
Commands run in a sandbox: the repository is writable except .git, .codex, and .claude at its root,
and there is no network. When a step needs more than that, such as a commit, a network request, or a path outside
the repository, request approval for that one command or patch and let the user decide. Never work
around the sandbox. An empty untracked .claude entry is the sandbox's placeholder: leave it alone.
Treat the attachment directory as read-only.`;

/**
 * `globalInstructions` is the user's framed text for a Docker turn. A local turn never names it:
 * local Codex loads its own global file.
 */
export function codexDeveloperInstructions(mode: AgentMode, globalInstructions?: string, level: SecurityLevel = 'guarded'): string {
  if (level === 'native') return 'Treat the attachment directory as read-only.';
  const own = mode === 'auto' ? CODEX_AUTO_DEVELOPER_INSTRUCTIONS : CODEX_DEVELOPER_INSTRUCTIONS;
  return globalInstructions ? `${own}\n\n${globalInstructions}` : own;
}

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

/**
 * Reads the first `model/list` page into server-owned choices. Hidden and out-of-bounds entries are
 * dropped. Default offers only the efforts every listed model accepts, because a Default turn runs
 * on whatever model its thread is on.
 */
export function codexModelChoices(value: unknown): ModelChoices {
  const data = record(value)?.data;
  if (!Array.isArray(data)) return {};
  const models: ProviderModel[] = [];
  for (const entry of data) {
    if (models.length >= MAX_PROVIDER_MODELS) break;
    const item = record(entry);
    if (!item || item.hidden === true || models.some((model) => model.id === item.model)) continue;
    const efforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts.map((option) => record(option)?.reasoningEffort)
      : [];
    const parsed = providerModelSchema.safeParse({ id: item.model, label: item.displayName, efforts: [...new Set(efforts)] });
    if (parsed.success) models.push(parsed.data);
  }
  const efforts = models[0]?.efforts.filter((effort) => models.every((model) => model.efforts.includes(effort))) ?? [];
  return { ...(models.length ? { models } : {}), ...(efforts.length ? { efforts } : {}) };
}

function codexSandboxApplied(response: Record<string, unknown> | undefined, expected: CodexTurnSecurity, level: SecurityLevel): boolean {
  const sandbox = record(response?.sandbox);
  if (expected.permissionProfile) {
    const profile = record(response?.activePermissionProfile);
    // The legacy projection beside the profile is where entries merged in from another config
    // layer show, such as a checkout's own `.codex/config.toml`: any extra root or network fails.
    return profile?.id === expected.permissionProfile && profile.extends === CODEX_AUTO_PROFILE.extends
      && sandbox?.type === 'workspaceWrite' && sandbox.networkAccess === false
      && Array.isArray(sandbox.writableRoots) && sandbox.writableRoots.length === 0;
  }
  if (expected.sandbox === 'workspace-write') return sandbox?.type === 'workspaceWrite';
  return expected.sandbox === 'danger-full-access'
    ? sandbox?.type === 'dangerFullAccess'
    : sandbox?.type === 'readOnly' && (level === 'native' || sandbox.networkAccess === false);
}

/** Verifies that App Server honored the server-owned thread policy and reported its instruction sources. */
export function codexThreadPolicyIssue(value: unknown, cwd: string, expected: CodexTurnSecurity, level: SecurityLevel = 'guarded'): string | undefined {
  const response = record(value);
  if (response?.cwd !== cwd || response?.approvalPolicy !== expected.approvalPolicy || !codexSandboxApplied(response, expected, level)
    || (expected.approvalsReviewer !== undefined && response.approvalsReviewer !== expected.approvalsReviewer)) {
    return 'Codex did not apply CodeAI\'s required provider-session sandbox and approval policy.';
  }
  if (!Array.isArray(response.instructionSources)) {
    return 'Codex did not report its effective instruction sources.';
  }
  if (response.instructionSources.some((source) => typeof source !== 'string' || !path.isAbsolute(source))) {
    return 'Codex reported an invalid instruction source.';
  }
  return undefined;
}

/**
 * Instruction files outside the repository (a user-level AGENTS.md, for example) are the user's own
 * Codex configuration, so they are reported as a path-free readiness note rather than blocking.
 */
export function codexAmbientInstructionNote(value: unknown, cwd: string): string | undefined {
  const sources = record(value)?.instructionSources;
  if (!Array.isArray(sources)) return undefined;
  const repositoryRoot = path.resolve(cwd);
  const ambient = sources.filter((source) => {
    if (typeof source !== 'string' || !path.isAbsolute(source)) return false;
    const relative = path.relative(repositoryRoot, path.resolve(source));
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  }).length;
  if (!ambient) return undefined;
  return `Local Codex also loads ${ambient} instruction file${ambient === 1 ? '' : 's'} from outside the repository, such as your global AGENTS.md. Global instructions in Machine settings shows that file.`;
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
  return undefined;
}

/**
 * User and repository skills are the user's own Codex configuration, like a user-level AGENTS.md.
 * They add instructions, not capabilities: MCP servers stay disabled and verified, and a command a
 * skill suggests runs through the turn's sandbox. So they are reported as a readiness note rather
 * than blocking.
 */
export function codexAmbientSkillNote(value: unknown): string | undefined {
  const data = record(value)?.data;
  if (!Array.isArray(data)) return undefined;
  const enabled = data.flatMap((entry) => {
    const item = record(entry);
    return Array.isArray(item?.skills) ? item.skills : [];
  }).filter((skill) => {
    const item = record(skill);
    return item?.enabled === true && (item.scope === 'user' || item.scope === 'repo');
  }).length;
  if (!enabled) return undefined;
  return `Codex also has ${enabled} user or repository skill${enabled === 1 ? '' : 's'} enabled.`
    + ' CodeAI asks it not to use them, and anything they run stays inside the session\'s sandbox.';
}
