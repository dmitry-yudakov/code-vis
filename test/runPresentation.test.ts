import { describe, expect, it } from 'vitest';
import {
  applyRunEvent, isReplayedStreamEvent, latestRunUserMessage, runOutcomeFromError,
  unreadAfterRunAttention, withSessionRunOutcome,
  type RunPresentation, type SessionRunOutcomes,
} from '@/features/conversation/runPresentation';
import type { AgentEvent, AssistantMessage, UserMessage } from '@/shared/types';

function presentation(sessionId: string, participantId: string): RunPresentation {
  return {
    sessionId,
    participantId,
    mode: 'ask',
    state: 'running',
    status: 'Starting',
    preview: '',
    toolActivity: [],
    runFailed: false,
    permissions: [],
  };
}

describe('run presentation isolation', () => {
  it('marks only the reported leading events as replayed', () => {
    expect([0, 1, 2, 3].map((index) => isReplayedStreamEvent(index, 2))).toEqual([
      true, true, false, false,
    ]);
    expect(isReplayedStreamEvent(0, 0)).toBe(false);
  });

  it('restores the accepted mode and terminal attention from canonical recovery state', () => {
    const message = (id: string, participantId: string, mode: UserMessage['mode']): UserMessage => ({
      id,
      role: 'user',
      authorId: 'human',
      addressedParticipantId: participantId,
      text: id,
      createdAt: '2026-09-02T00:00:00.000Z',
      status: 'sending',
      diagramAttachments: [],
      mode,
    });
    const accepted = latestRunUserMessage([
      message('older-plan', 'agent-a', 'plan'),
      message('other-agent', 'agent-b', 'ask'),
      message('accepted-agent-turn', 'agent-a', 'agent'),
    ], 'agent-a');

    expect(accepted?.id).toBe('accepted-agent-turn');
    expect(accepted?.mode).toBe('agent');
    expect(unreadAfterRunAttention(0, true)).toBe(1);
    expect(unreadAfterRunAttention(1, true)).toBe(1);
    expect(unreadAfterRunAttention(1, false)).toBe(2);
  });

  it('keeps terminal outcomes and continuation actions scoped to their sessions', () => {
    let outcomes: SessionRunOutcomes = {};
    outcomes = withSessionRunOutcome(outcomes, 'session-a', runOutcomeFromError({
      type: 'error',
      runId: 'run-a',
      code: 'max-turns',
      message: 'First turn reached its limit',
      retryable: true,
      delivery: 'possibly-sent',
    }, 'plan'));
    outcomes = withSessionRunOutcome(outcomes, 'session-b', runOutcomeFromError({
      type: 'error',
      runId: 'run-b',
      code: 'max-turns',
      message: 'Second turn reached its limit',
      retryable: true,
      delivery: 'possibly-sent',
    }, 'agent'));

    expect(outcomes).toEqual({
      'session-a': {
        runId: 'run-a',
        message: 'First turn reached its limit',
        missingProviderSession: false,
        continueMode: 'plan',
      },
      'session-b': {
        runId: 'run-b',
        message: 'Second turn reached its limit',
        missingProviderSession: false,
        continueMode: 'agent',
      },
    });

    outcomes = withSessionRunOutcome(outcomes, 'session-a');
    expect(outcomes['session-a']).toBeUndefined();
    expect(outcomes['session-b']?.continueMode).toBe('agent');
  });

  it('reduces every event variant only into its addressed run under forced interleaving', () => {
    const firstRunId = '11111111-1111-4111-8111-111111111111';
    const secondRunId = '22222222-2222-4222-8222-222222222222';
    const states: Record<'first' | 'second', RunPresentation> = {
      first: presentation('session-a', 'agent-a'),
      second: presentation('session-b', 'agent-b'),
    };
    let key = 0;
    const dispatch = (target: keyof typeof states, event: AgentEvent) => {
      states[target] = applyRunEvent(states[target], event, key++);
    };

    dispatch('first', { type: 'status', runId: firstRunId, phase: 'queued', label: 'Queued · position 2' });
    dispatch('second', {
      type: 'run-started',
      runId: secondRunId,
      sessionId: 'session-b',
      messageId: 'message-b',
      participantId: 'agent-b',
    });
    dispatch('first', {
      type: 'run-started',
      runId: firstRunId,
      sessionId: 'session-a',
      messageId: 'message-a',
      participantId: 'agent-a',
    });
    dispatch('second', { type: 'assistant-delta', runId: secondRunId, delta: 'second preview' });
    dispatch('first', { type: 'tool-activity', runId: firstRunId, tool: 'Read', detail: 'README.md' });
    dispatch('first', { type: 'assistant-delta', runId: firstRunId, delta: 'first preview' });
    dispatch('first', {
      type: 'permission-request',
      runId: firstRunId,
      requestId: 'permission-a',
      participantId: 'agent-a',
      tool: 'Edit',
      detail: 'src/a.ts',
    });
    dispatch('second', { type: 'status', runId: secondRunId, phase: 'thinking', label: 'Thinking…' });
    dispatch('first', {
      type: 'permission-resolved',
      runId: firstRunId,
      requestId: 'permission-a',
      decision: 'deny',
    });
    dispatch('first', {
      type: 'assistant-message',
      runId: firstRunId,
      message: { id: 'assistant-a' } as AssistantMessage,
    });
    dispatch('second', {
      type: 'error',
      runId: secondRunId,
      code: 'timeout',
      message: 'Second timed out',
      retryable: true,
      delivery: 'possibly-sent',
    });
    dispatch('first', { type: 'done', runId: firstRunId, durationMs: 10, cancelled: false });
    dispatch('second', { type: 'done', runId: secondRunId, durationMs: 11, cancelled: false });

    expect(states.first).toMatchObject({
      runId: firstRunId,
      sessionId: 'session-a',
      state: 'running',
      preview: '',
      runFailed: false,
      permissions: [],
      pendingPermissionCount: 0,
      toolActivity: [{ tool: 'Read', detail: 'README.md' }],
    });
    expect(states.second).toMatchObject({
      runId: secondRunId,
      sessionId: 'session-b',
      state: 'running',
      preview: 'second preview',
      runFailed: true,
      status: 'Second timed out',
      permissions: [],
      toolActivity: [],
    });
  });
});
