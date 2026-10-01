import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { buildClaudeArgs, REQUIRED_CLAUDE_FLAGS } from '@/server/agents/claudeInvocation';
import { inspectClaudeHelp } from '@/server/agents/claudePreflight';
import { buildCodexAppServerArgs, codexDeveloperInstructions, codexThreadConfig, codexThreadPolicyIssue, codexTurnSecurity } from '@/server/agents/codexInvocation';
import { buildConversationPrompt } from '@/server/conversation/prompt';
import { AGENT_MODES, changesCheckout, composerMode, unsupportedModes } from '@/shared/agentModes';
import { instructionsLine, nativeClaudeIsolationIssue } from '@/shared/globalInstructions';
import { InstructionComposer } from '@/features/conversation/InstructionComposer';
import { inheritedMode } from '@/features/shell/devicePreferences';
import { immersiveMessageEntry } from '@/features/diagram/spatial/immersiveTranscript';
import type { AgentMode, SecurityLevel } from '@/shared/types';

const cached = globalThis as typeof globalThis & { __codeaiSecurityLevel?: SecurityLevel };
afterEach(() => { delete cached.__codeaiSecurityLevel; vi.unstubAllEnvs(); });
const config = () => ({ ...getConfig(), securityLevel: 'native' as const });
const args = (mode: AgentMode, native = true, execution: 'local' | 'docker' = 'local') => buildClaudeArgs({
  session: { id: 'session', action: 'start' }, attachmentDirectory: '/context',
  policy: resolveAgentPolicy({ ...config(), securityLevel: native ? 'native' : 'guarded' }, mode, execution),
  appendSystemPrompt: 'USER_INSTRUCTIONS',
});

describe('machine security level', () => {
  it('defaults to Guarded and freezes its first value for the process', () => {
    vi.stubEnv('CODEAI_SECURITY_LEVEL', ''); vi.stubEnv('CODEAI_WEB2_SECURITY_LEVEL', '');
    expect(getConfig().securityLevel).toBe('guarded');
    vi.stubEnv('CODEAI_SECURITY_LEVEL', 'native');
    expect(getConfig().securityLevel).toBe('guarded');
    delete cached.__codeaiSecurityLevel;
    expect(getConfig().securityLevel).toBe('native');
    vi.stubEnv('CODEAI_SECURITY_LEVEL', 'invalid');
    expect(getConfig().securityLevel).toBe('native');
  });
  it('supports the former setting name and rejects invalid values with the selected name', () => {
    vi.stubEnv('CODEAI_SECURITY_LEVEL', ''); vi.stubEnv('CODEAI_WEB2_SECURITY_LEVEL', 'native');
    expect(getConfig().securityLevel).toBe('native'); delete cached.__codeaiSecurityLevel;
    vi.stubEnv('CODEAI_SECURITY_LEVEL', 'oops');
    expect(() => getConfig()).toThrow('CODEAI_SECURITY_LEVEL');
    vi.stubEnv('CODEAI_SECURITY_LEVEL', ''); vi.stubEnv('CODEAI_WEB2_SECURITY_LEVEL', 'oops');
    expect(() => getConfig()).toThrow('CODEAI_WEB2_SECURITY_LEVEL');
  });
});

describe('Native invocation contracts', () => {
  it.each(['ask', 'plan', 'agent'] as const)('keeps Docker %s byte-for-byte Guarded', (mode) => {
    expect(args(mode, true, 'docker')).toEqual(args(mode, false, 'docker'));
    expect(resolveAgentPolicy(config(), mode, 'docker').level).toBe('guarded');
  });
  it.each(['ask', 'plan'] as const)('keeps Local %s Guarded at Native', (mode) => {
    expect(args(mode)).toEqual(args(mode, false));
    expect(resolveAgentPolicy(config(), mode).level).toBe('guarded');
  });
  it.each([['agent', 'default'], ['edits', 'acceptEdits'], ['auto', 'auto'], ['full', 'bypassPermissions']] as const)(
    'runs Claude %s with native permission mode %s and no isolation flags', (mode, permission) => {
      const policy = resolveAgentPolicy(config(), mode);
      expect(policy).toMatchObject({ level: 'native', profile: 'native', interactivePermissions: true,
        maxTurns: config().buildMaxTurns, timeoutMs: config().buildTimeoutMs });
      expect(Object.isFrozen(policy)).toBe(true);
      const list = args(mode);
      expect(list[list.indexOf('--permission-mode') + 1]).toBe(permission);
      for (const flag of ['--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--append-system-prompt']) expect(list).not.toContain(flag);
      expect(list).toContain('--allowedTools');
      expect(list.slice(-4)).toEqual(['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio']);
    },
  );
  it('advertises Native Claude modes only when their permission choice is documented', () => {
    const help = REQUIRED_CLAUDE_FLAGS.join(' ') + '\n--permission-mode <mode> (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "plan")';
    expect(inspectClaudeHelp(help, 'native').missingByMode).toEqual([]);
    const missing = inspectClaudeHelp(help.replace('"auto", ', ''), 'native').missingByMode;
    expect(missing).toEqual([{ mode: 'auto', missing: ['auto'] }]);
    expect(inspectClaudeHelp(help, 'guarded').missingByMode).toEqual([]);
  });
  it('leaves only the two turn-wide permission features off in Codex Native', () => {
    expect(buildCodexAppServerArgs('native')).toEqual(['app-server', '--stdio', '--strict-config',
      '--disable', 'request_permissions_tool', '--disable', 'exec_permission_approvals']);
    expect(codexThreadConfig(['ambient'], undefined, 'native')).toEqual({ features: { request_permissions_tool: false, exec_permission_approvals: false } });
    expect(codexDeveloperInstructions('auto', undefined, 'native')).toBe('Treat the attachment directory as read-only.');
  });
  it.each([['agent', 'read-only', 'readOnly', 'on-request'], ['auto', 'workspace-write', 'workspaceWrite', 'on-request'], ['full', 'danger-full-access', 'dangerFullAccess', 'never']] as const)(
    'checks Native Codex %s cwd, approval and sandbox while inheriting roots, network and reviewer', (mode, sandbox, type, approval) => {
      const security = codexTurnSecurity(mode, 'local', 'native');
      expect(security).toMatchObject({ approvalPolicy: approval, sandbox });
      expect(security).not.toHaveProperty('approvalsReviewer');
      if (mode !== 'agent') expect(security).not.toHaveProperty('sandboxPolicy');
      const echo = { cwd: '/repo', approvalPolicy: approval, sandbox: { type, networkAccess: true, writableRoots: ['/outside'] },
        approvalsReviewer: 'auto_review', instructionSources: ['/home/user/AGENTS.md'] };
      expect(codexThreadPolicyIssue(echo, '/repo', security, 'native')).toBeUndefined();
      for (const bad of [{ cwd: '/wrong' }, { approvalPolicy: 'wrong' }, { sandbox: { type: 'wrong' } }, { instructionSources: ['relative'] }]) {
        expect(codexThreadPolicyIssue({ ...echo, ...bad }, '/repo', security, 'native')).toBeDefined();
      }
    },
  );
});

describe('Native modes in the conversation', () => {
  it('uses the same Native mode names in the immersive transcript', () => {
    for (const [mode, level, label] of [['agent', 'native', 'Native · Agent'], ['edits', undefined, 'Accept edits'], ['full', undefined, 'Full access']] as const) {
      const entry = immersiveMessageEntry({ id: 'message', role: 'assistant', authorId: 'agent', createdAt: '',
        status: 'complete', rawMarkdown: 'Done', blocks: [], mode, level }, new Map());
      expect(entry.meta).toBe(`Assistant · ${label}`);
    }
  });
  it('orders six modes, keeps writing exclusive, and never inherits extra modes into a new session', () => {
    expect(AGENT_MODES).toEqual(['ask', 'plan', 'agent', 'edits', 'auto', 'full']);
    for (const mode of ['agent', 'edits', 'auto', 'full'] as const) expect(changesCheckout(mode)).toBe(true);
    for (const mode of ['edits', 'auto', 'full'] as const) expect(inheritedMode(mode, 'local')).toBe('ask');
    expect(unsupportedModes(undefined)).toEqual(['edits', 'auto', 'full']);
    expect(unsupportedModes(AGENT_MODES, 'docker')).toEqual(['edits', 'auto', 'full']);
  });
  it('never falls back from an unavailable mode to a writing mode', () => {
    expect(composerMode('ask', unsupportedModes(['full']))).toBe('ask');
    expect(composerMode('agent', unsupportedModes(['auto', 'full']))).toBe('ask');
    expect(composerMode('full', unsupportedModes(['plan', 'full']))).toBe('full');
    expect(composerMode('agent', unsupportedModes(['plan', 'full']))).toBe('plan');
    expect(inheritedMode('agent', 'docker')).toBe('ask');
  });
  it('requires setting sources for Local read-only Claude, but not the Docker worker', () => {
    const help = REQUIRED_CLAUDE_FLAGS.filter((flag) => flag !== '--setting-sources').join(' ');
    expect(inspectClaudeHelp(help).missingByMode).toEqual([
      { mode: 'ask', missing: ['--setting-sources'] }, { mode: 'plan', missing: ['--setting-sources'] },
    ]);
    expect(inspectClaudeHelp(help, 'guarded', 'docker').missingByMode).toEqual([]);
  });
  it('disables isolated Local Claude writing and reports its natively loaded instructions', () => {
    const input = { provider: 'claude' as const, execution: 'local' as const, level: 'native' as const, mode: 'auto' as const, choice: 'isolated' as const };
    expect(nativeClaudeIsolationIssue(input)).toBe('This session runs without your global instructions, and Claude loads them itself in Native writing modes.');
    expect(nativeClaudeIsolationIssue({ ...input, mode: 'ask' })).toBeUndefined();
    expect(nativeClaudeIsolationIssue({ ...input, execution: 'docker' })).toBeUndefined();
    expect(instructionsLine({ ...input, choice: 'global' })).toBe('global');
  });
  it('describes Native writing according to the provider without promising a sandbox', () => {
    for (const mode of ['agent', 'edits', 'auto', 'full'] as const) {
      const prompt = buildConversationPrompt({ userText: 'hi', attachmentDirectory: '/context', attachedCanvasNames: [], mode, level: 'native' });
      expect(prompt).not.toContain('Any other command is denied automatically');
      expect(prompt).not.toContain('there is no network');
      expect(prompt).toContain(`Mode: ${mode.toUpperCase()}`);
    }
    expect(buildConversationPrompt({ userText: 'hi', attachmentDirectory: '/context', attachedCanvasNames: [], mode: 'full', level: 'native' })).toContain('Uncommitted work has no backup');
  });
  it('shows Native modes, Native execution and isolated-mode reasons in the picker', () => {
    const render = (securityLevel: SecurityLevel, isolated = false) => renderToStaticMarkup(createElement(InstructionComposer, {
      value: '', running: false, attached: [], markCounts: {}, mode: 'auto', unsupportedModes: [], securityLevel, provider: 'claude', isolated,
      modelSelection: {}, theme: 'light', recentCanvases: [], continuation: { onContinue() {} },
      onChange() {}, onModeChange() {}, onModelSelectionChange() {}, onSend() {}, onCancel() {}, onRemoveAttachment() {},
      onToggleAttachment() {}, onOpenHistory() {}, onNewSketch() {},
    }));
    const native = render('native');
    expect(native).toContain('Accept edits'); expect(native).toContain('Full access');
    expect(native).toContain('A model approves each action'); expect(native).toContain('>Native<');
    expect(native).not.toContain('More modes at Native');
    expect(render('native', true)).toContain('This session runs without your global instructions');
    expect(render('guarded')).toContain('More modes at Native');
  });
});
