import { describe, expect, it } from 'vitest';
import { agentMessageRequestSchema, createThreadRequestSchema } from '@/shared/protocol';

const ids = {
  threadId: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
  participantId: 'agent-1',
};

describe('provider protocol contracts', () => {
  it('requires a supported provider when creating a thread', () => {
    expect(createThreadRequestSchema.parse({ checkoutId: 'project', provider: 'codex' }).provider).toBe('codex');
    expect(createThreadRequestSchema.parse({ provider: 'codex' }).checkoutId).toBeUndefined();
    expect(() => createThreadRequestSchema.parse({ checkoutId: 'project' })).toThrow();
    expect(() => createThreadRequestSchema.parse({ checkoutId: 'project', provider: 'other' })).toThrow();
    expect(() => createThreadRequestSchema.parse({ projectId: 'legacy', provider: 'codex' })).toThrow();
  });

  it('does not allow the browser to override the provider for a turn', () => {
    const request = { ...ids, text: 'Explain this.', diagramAttachments: [] };
    expect(agentMessageRequestSchema.parse(request)).toMatchObject(request);
    expect(() => agentMessageRequestSchema.parse({ ...request, provider: 'codex' })).toThrow();
    expect(() => agentMessageRequestSchema.parse({ ...request, projectId: 'legacy' })).toThrow();
    expect(() => agentMessageRequestSchema.parse({ ...request, transcript: [] })).toThrow();
  });
});
