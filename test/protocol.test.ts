import { describe, expect, it } from 'vitest';
import { agentMessageRequestSchema, createThreadRequestSchema } from '@/shared/protocol';

const ids = {
  threadId: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
  participantId: 'agent-1',
};

describe('provider protocol contracts', () => {
  it('requires a supported provider when creating a thread', () => {
    expect(createThreadRequestSchema.parse({ projectId: 'project', provider: 'codex' }).provider).toBe('codex');
    expect(() => createThreadRequestSchema.parse({ projectId: 'project' })).toThrow();
    expect(() => createThreadRequestSchema.parse({ projectId: 'project', provider: 'other' })).toThrow();
  });

  it('does not allow the browser to override the provider for a turn', () => {
    const request = { ...ids, projectId: 'project', text: 'Explain this.', transcript: [], diagramAttachments: [] };
    expect(agentMessageRequestSchema.parse(request)).toMatchObject(request);
    expect(() => agentMessageRequestSchema.parse({ ...request, provider: 'codex' })).toThrow();
  });
});
