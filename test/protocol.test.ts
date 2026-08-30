import { describe, expect, it } from 'vitest';
import { agentMessageRequestSchema, createSessionRequestSchema } from '@/shared/protocol';

const ids = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
  participantId: 'agent-1',
};

describe('provider protocol contracts', () => {
  it('requires a supported provider when creating a session', () => {
    expect(createSessionRequestSchema.parse({ projectId: ids.sessionId, provider: 'codex' }).provider).toBe('codex');
    expect(createSessionRequestSchema.parse({ provider: 'codex' }).projectId).toBeUndefined();
    expect(() => createSessionRequestSchema.parse({ projectId: ids.sessionId })).toThrow();
    expect(() => createSessionRequestSchema.parse({ projectId: ids.sessionId, provider: 'other' })).toThrow();
    expect(() => createSessionRequestSchema.parse({ checkoutId: 'legacy', provider: 'codex' })).toThrow();
  });

  it('does not allow the browser to override the provider for a turn', () => {
    const request = { ...ids, text: 'Explain this.', diagramAttachments: [] };
    expect(agentMessageRequestSchema.parse(request)).toMatchObject(request);
    expect(() => agentMessageRequestSchema.parse({ ...request, provider: 'codex' })).toThrow();
    expect(() => agentMessageRequestSchema.parse({ ...request, projectId: 'legacy' })).toThrow();
    expect(() => agentMessageRequestSchema.parse({ ...request, transcript: [] })).toThrow();
  });
});
