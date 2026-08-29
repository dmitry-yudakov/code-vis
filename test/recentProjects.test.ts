import { describe, expect, it } from 'vitest';
import { groupProjects } from '@/features/projects/projectPickerModel';
import { recentProjectIds } from '@/server/projects/recentProjects';
import type { DurableSession, ProjectAttachment, ProjectSummary } from '@/shared/types';

const hostId = '11111111-1111-4111-8111-111111111111';

function attachment(checkoutId: string, role: ProjectAttachment['role'] = 'primary', attachedHostId = hostId): ProjectAttachment {
  return { id: `${checkoutId}-${role}`, hostId: attachedHostId, checkoutId, role };
}

function activity(updatedAt: string, attachments: ProjectAttachment[]): Pick<DurableSession, 'attachments' | 'updatedAt'> {
  return { attachments, updatedAt };
}

function project(id: string): ProjectSummary {
  return { id, name: id.toUpperCase(), relativePath: id };
}

describe('recent projects', () => {
  it('uses each current project’s newest local primary session and limits the result to five', () => {
    const projects = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(project);
    const sessions = [
      activity('2026-08-20T00:00:00.000Z', [attachment('a')]),
      activity('2026-08-28T00:00:00.000Z', [attachment('a')]),
      activity('2026-08-27T00:00:00.000Z', [attachment('b')]),
      activity('2026-08-30T00:00:00.000Z', [attachment('b', 'primary', '22222222-2222-4222-8222-222222222222')]),
      activity('2026-08-29T00:00:00.000Z', [attachment('c', 'reference')]),
      activity('2026-08-26T00:00:00.000Z', [attachment('d')]),
      activity('2026-08-25T00:00:00.000Z', [attachment('e')]),
      activity('2026-08-24T00:00:00.000Z', [attachment('f')]),
      activity('2026-08-23T00:00:00.000Z', [attachment('g')]),
      activity('2026-08-31T00:00:00.000Z', [attachment('no-longer-discovered')]),
    ];

    expect(recentProjectIds(projects, sessions, hostId)).toEqual(['a', 'b', 'd', 'e', 'f']);
  });

  it('uses registry order as a deterministic tie breaker', () => {
    const projects = ['b', 'a'].map(project);
    const sessions = [
      activity('2026-08-28T00:00:00.000Z', [attachment('a')]),
      activity('2026-08-28T00:00:00.000Z', [attachment('b')]),
    ];

    expect(recentProjectIds(projects, sessions, hostId)).toEqual(['b', 'a']);
  });

  it('groups recent projects once in activity order and leaves other projects in registry order', () => {
    const projects = ['a', 'b', 'c', 'd'].map(project);

    expect(groupProjects(projects, ['c', 'missing', 'a', 'c'])).toEqual({
      recent: [project('c'), project('a')],
      other: [project('b'), project('d')],
    });
  });
});
