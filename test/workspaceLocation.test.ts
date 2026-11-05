import { describe, expect, it } from 'vitest';
import { parseWorkspaceLocation, workspaceHref } from '@/features/shell/workspaceLocation';

const sessionId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const hostId = '33333333-3333-4333-8333-333333333333';
const executorId = '44444444-4444-4444-8444-444444444444';

describe('workspace URLs', () => {
  it('defaults to the serving host and derives the project from the conversation', () => {
    const href = workspaceHref({ sessionId, projectId, machineId: hostId }, hostId);
    expect(href).toBe(`/?session=${sessionId}`);
    expect(parseWorkspaceLocation(new URLSearchParams(href.slice(2)))).toEqual({ kind: 'session', sessionId });
  });

  it('qualifies only an attached executor, independent of machine count', () => {
    const href = workspaceHref({ sessionId, machineId: executorId }, hostId);
    expect(href).toBe(`/?session=${sessionId}&machine=${executorId}`);
    expect(parseWorkspaceLocation(new URLSearchParams(href.slice(2)))).toEqual({ kind: 'session', sessionId, machineId: executorId });
  });

  it('preserves an empty project workspace and No project explicitly', () => {
    expect(workspaceHref({ projectId }, hostId)).toBe(`/?project=${projectId}`);
    expect(parseWorkspaceLocation(new URLSearchParams(`project=${projectId}`))).toEqual({ kind: 'project', projectId });
    expect(workspaceHref({ machineId: executorId }, hostId)).toBe(`/?project=none&machine=${executorId}`);
    expect(parseWorkspaceLocation(new URLSearchParams('project=none'))).toEqual({ kind: 'project' });
  });

  it('keeps unqualified entry distinct from an explicitly empty workspace', () => {
    expect(parseWorkspaceLocation(new URLSearchParams())).toEqual({ kind: 'default' });
    expect(parseWorkspaceLocation(new URLSearchParams('unrelated=1'))).toEqual({ kind: 'default' });
  });

  it.each([
    'session=', 'session=bad', `session=${sessionId}&session=${sessionId}`,
    `session=${sessionId}&machine=bad`, `session=${sessionId}&project=${projectId}`,
    'project=bad', 'machine=bad', `machine=${executorId}`, 'project=none&project=none',
    `session=${sessionId}&machine=${hostId}&machine=${executorId}`,
  ])('rejects malformed or ambiguous destinations: %s', (query) => {
    expect(parseWorkspaceLocation(new URLSearchParams(query)).kind).toBe('invalid');
  });
});
