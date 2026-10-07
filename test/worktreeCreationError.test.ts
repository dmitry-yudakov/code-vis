import { describe, expect, it } from 'vitest';
import { worktreeCreationError } from '@/features/conversation/worktreeCreationError';
import { worktreeCreationConflictSchema } from '@/shared/worktreeCreation';
import type { ArenaMachineSnapshot } from '@/shared/types';

const homeId = crypto.randomUUID(), remoteId = crypto.randomUUID(), sessionId = crypto.randomUUID();
function machine(id: string, label: string, title: string): ArenaMachineSnapshot {
  return { machine: { id, label, kind: id === homeId ? 'local' : 'remote', state: 'online' },
    projects: [], checkouts: [], recentCheckoutIds: [], archivedSessions: [], runs: { active: [], recent: [] },
    providers: { claude: { available: false, authenticated: false, supportedModes: [] }, codex: { available: false, authenticated: false, supportedModes: [] } },
    sessions: [{ id: sessionId, title, revision: 0, repositoryCheckoutIds: [], agents: [], updatedAt: new Date().toISOString() }],
  };
}

describe('worktree conflict presentation', () => {
  it('uses the addressed executor and its session even when ids also occur on the home machine', () => {
    const error = worktreeCreationError({ worktreeConflict: { machineId: remoteId, kind: 'turn',
      blockingTurns: [{ sessionId, state: 'needs-you' }] } },
    [machine(homeId, 'Home', 'Wrong session'), machine(remoteId, 'Remote', 'Remote task')]);
    expect(error).toContain('on Remote');
    expect(error).toContain('“Remote task” (waiting for you)');
    expect(error).not.toContain('Wrong session');
  });

  it('preserves useful fallbacks when the catalog is stale or an older server supplies only text', () => {
    expect(worktreeCreationError({ error: 'Existing server reason' }, [])).toBe('Existing server reason');
    expect(worktreeCreationError({ worktreeConflict: { machineId: remoteId, kind: 'turn', blockingTurns: [{ sessionId, state: 'queued' }] } }, []))
      .toContain('another session (queued)');
    expect(worktreeCreationError({ worktreeConflict: { machineId: remoteId, kind: 'maintenance' } }, []))
      .toContain('maintenance is in progress');
  });

  it('rejects unexpected/private fields and unbounded blocker lists', () => {
    expect(worktreeCreationConflictSchema.safeParse({ machineId: remoteId, kind: 'git-read', path: '/private' }).success).toBe(false);
    expect(worktreeCreationConflictSchema.safeParse({ machineId: remoteId, kind: 'turn', blockingTurns:
      Array.from({ length: 9 }, () => ({ sessionId, state: 'running' })) }).success).toBe(false);
  });
});
