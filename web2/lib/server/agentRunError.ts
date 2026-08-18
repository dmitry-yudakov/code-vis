import type { AgentErrorCode } from '@/lib/shared/types';

export class AgentRunError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly delivery: 'not-sent' | 'possibly-sent' = 'possibly-sent',
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}
