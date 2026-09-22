import { describe, expect, it } from 'vitest';
import {
  pendingReportLabel, reportAttachmentSummary, reportCaptureLabel, reportDescription,
} from '@/features/reports/reportModel';
import type { ArenaMachineSnapshot, ReportAttachmentRecord } from '@/shared/types';

const MACHINE = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ARCHIVED = '55555555-5555-4555-8555-555555555555';

const machines = [{
  machine: { id: MACHINE, label: 'Home', kind: 'local', state: 'online' },
  projects: [
    { version: 1, revision: 0, id: PROJECT, name: 'CodeAI', repositories: [], createdAt: '', updatedAt: '' },
    { version: 1, revision: 0, id: OTHER_PROJECT, name: 'Garden', repositories: [], createdAt: '', updatedAt: '' },
  ],
  sessions: [{ id: SESSION, revision: 0, title: 'Fix the clipped panel', repositoryCheckoutIds: [], agents: [], updatedAt: '' }],
  archivedSessions: [{ id: ARCHIVED, revision: 0, title: 'Earlier work', repositoryCheckoutIds: [], agents: [], updatedAt: '' }],
} as unknown as ArenaMachineSnapshot];

describe('report labels', () => {
  it('says where a report was captured from this device catalog, and only as a label', () => {
    expect(reportCaptureLabel({ machineId: MACHINE, projectId: PROJECT, sessionId: SESSION }, machines, PROJECT))
      .toBe('Captured in this project › Fix the clipped panel');
    expect(reportCaptureLabel({ machineId: MACHINE, projectId: OTHER_PROJECT, sessionId: ARCHIVED }, machines, PROJECT))
      .toBe('Captured in Garden › Earlier work');
    expect(reportCaptureLabel({ machineId: MACHINE, projectId: crypto.randomUUID() }, machines, PROJECT))
      .toBe('Captured in a project that is no longer available');
    expect(reportCaptureLabel({ machineId: MACHINE, sessionId: SESSION }, machines, PROJECT))
      .toBe('Captured in Fix the clipped panel, outside any project');
    expect(reportCaptureLabel({ machineId: MACHINE, sessionId: crypto.randomUUID() }, machines, PROJECT)).toBe('Captured outside any project');
    expect(reportCaptureLabel({ machineId: MACHINE }, machines, PROJECT)).toBe('Captured with no session selected');
    expect(reportCaptureLabel(undefined, machines, PROJECT)).toBe('Captured with no session selected');
  });

  it('describes a report by its note, or an error report by its latest error', () => {
    expect(reportDescription({ kind: 'capture', note: 'Clipped', latestError: 'TypeError' })).toBe('Clipped');
    expect(reportDescription({ kind: 'error', note: 'window-error', latestError: 'TypeError' })).toBe('TypeError');
    expect(reportDescription({ kind: 'capture' })).toBe('No note or error text.');
    expect(pendingReportLabel('2026-09-21T18-12-03.123Z-capture')).toMatch(/^CodeAI report · /);
  });

  it('states how many reports a message carried and whether they hold screenshots or errors', () => {
    const record = (screenshotIncluded: boolean, errorCount: number): ReportAttachmentRecord => ({
      reportId: '2026-09-21T18-12-03.123Z-capture', receivedAt: '2026-09-21T18:12:03.123Z', kind: 'capture', screenshotIncluded, errorCount,
    });
    expect(reportAttachmentSummary([record(true, 0)])).toBe('1 CodeAI report attached · screenshot');
    expect(reportAttachmentSummary([record(true, 1), record(false, 2)])).toBe('2 CodeAI reports attached · 1 with screenshot · 3 errors');
    expect(reportAttachmentSummary([record(true, 0), record(true, 0)])).toBe('2 CodeAI reports attached · screenshots');
    expect(reportAttachmentSummary([record(false, 0)])).toBe('1 CodeAI report attached');
  });
});
