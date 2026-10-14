import { describe, expect, it } from 'vitest';
import { buildConversationPrompt } from '@/server/conversation/prompt';
import { codexTurnSecurity } from '@/server/agents/codexInvocation';
import type { AgentExecution, AgentMode, SecurityLevel } from '@/shared/types';

const prompt = (mode: AgentMode, level: SecurityLevel = 'native', execution: AgentExecution = 'local') =>
  buildConversationPrompt({ mode, level, execution, userText: 'Stage and commit my changes only.',
    attachmentDirectory: '/context', attachedCanvasNames: [] });

describe('Native Auto Git approvals', () => {
  it('explains protected Git metadata and how to request approval for one command', () => {
    const text = prompt('auto');
    expect(text).toContain('.git');
    expect(text).toContain('staging, unstaging and committing');
    expect(text).toContain('sandbox_permissions="require_escalated"');
    expect(text).toContain('justification');
    expect(text).toContain('configured reviewer');
  });

  it('distinguishes a sandbox failure from a denial and preserves the configured policy', () => {
    const text = prompt('auto');
    expect(text).toContain('A sandbox failure alone is not an approval denial');
    expect(text).toContain('does not change the configured sandbox policy');
    expect(text).toContain('Do not work around a denial');
    expect(codexTurnSecurity('auto', 'local', 'native')).toEqual({
      approvalPolicy: 'on-request', sandbox: 'workspace-write',
    });
  });

  it.each([
    ['ask', 'native', 'local'], ['plan', 'native', 'local'], ['full', 'native', 'local'],
    ['auto', 'guarded', 'local'], ['agent', 'native', 'docker'],
  ] as const)('keeps the %s/%s/%s contract separate', (mode, level, execution) => {
    expect(prompt(mode, level, execution)).not.toContain('sandbox_permissions="require_escalated"');
  });
});
