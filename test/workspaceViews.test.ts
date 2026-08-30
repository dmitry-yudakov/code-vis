import { describe, expect, it } from 'vitest';
import {
  EMPTY_DEVICE_WORKSPACE,
  closeWorkspaceView,
  ensureWorkspaceView,
  getWorkspaceScope,
  getWorkspaceViewIds,
  openWorkspaceView,
  parseDeviceWorkspace,
  reconcileWorkspaceScope,
  replacePendingCanvasRevision,
  updateWorkspaceView,
  workspaceScopeKey,
} from '@/features/shell/workspaceViews';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANVAS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REVISION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OTHER_CANVAS = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scopeId = workspaceScopeKey(PROJECT);

describe('device workspace views', () => {
  it('opens, focuses, closes, and ensures views without touching their device state', () => {
    let workspace = openWorkspaceView(EMPTY_DEVICE_WORKSPACE, scopeId, SESSION_A);
    workspace = updateWorkspaceView(workspace, scopeId, SESSION_A, (view) => ({ ...view, composer: 'keep me' }));
    workspace = openWorkspaceView(workspace, scopeId, SESSION_B);
    expect(getWorkspaceScope(workspace, scopeId)).toMatchObject({
      openSessionIds: [SESSION_A, SESSION_B],
      focusedSessionId: SESSION_B,
    });

    workspace = ensureWorkspaceView(workspace, scopeId, SESSION_A);
    expect(getWorkspaceScope(workspace, scopeId).focusedSessionId).toBe(SESSION_B);
    workspace = closeWorkspaceView(workspace, scopeId, SESSION_B);
    expect(getWorkspaceScope(workspace, scopeId)).toMatchObject({
      openSessionIds: [SESSION_A],
      focusedSessionId: SESSION_A,
    });
    expect(getWorkspaceScope(workspace, scopeId).views[SESSION_A].composer).toBe('keep me');
  });

  it('reconciles stale ids while restoring order and focus', () => {
    const stored = parseDeviceWorkspace(JSON.stringify({
      version: 1,
      scopes: {
        [scopeId]: {
          openSessionIds: [MISSING, SESSION_B, SESSION_A],
          focusedSessionId: SESSION_B,
          views: {
            [SESSION_A]: { composer: 'A', unread: 0, canvasViews: {} },
            [SESSION_B]: { composer: 'B', unread: 2, canvasViews: {} },
            [MISSING]: { composer: 'gone', unread: 0, canvasViews: {} },
          },
        },
      },
    }));
    const reconciled = reconcileWorkspaceScope(stored, scopeId, [SESSION_A, SESSION_B]);
    expect(getWorkspaceScope(reconciled, scopeId)).toMatchObject({
      openSessionIds: [SESSION_B, SESSION_A],
      focusedSessionId: SESSION_B,
    });
    expect(getWorkspaceScope(reconciled, scopeId).views[MISSING]).toBeUndefined();
  });

  it('reports retained views across project scopes for layout reconciliation', () => {
    const otherScope = workspaceScopeKey('22222222-2222-4222-8222-222222222222');
    let workspace = openWorkspaceView(EMPTY_DEVICE_WORKSPACE, scopeId, SESSION_A);
    workspace = openWorkspaceView(workspace, otherScope, SESSION_B);
    workspace = reconcileWorkspaceScope(workspace, scopeId, []);
    expect(getWorkspaceViewIds(workspace)).toEqual([SESSION_B]);
  });

  it('replaces an automatically revised attachment without discarding explicit extras', () => {
    expect(replacePendingCanvasRevision([CANVAS, OTHER_CANVAS], CANVAS, REVISION)).toEqual([
      REVISION,
      OTHER_CANVAS,
    ]);
    expect(replacePendingCanvasRevision([OTHER_CANVAS], CANVAS, REVISION)).toEqual([OTHER_CANVAS]);
    expect(replacePendingCanvasRevision(undefined, CANVAS, REVISION)).toBeUndefined();
  });

  it('parses and bounds only device-owned fields', () => {
    const parsed = parseDeviceWorkspace(JSON.stringify({
      version: 1,
      scopes: {
        [scopeId]: {
          openSessionIds: [SESSION_A, SESSION_A, 'not-an-id'],
          focusedSessionId: SESSION_A,
          views: {
            [SESSION_A]: {
              composer: 'draft',
              pendingAttachmentIds: [CANVAS, CANVAS],
              unread: 2_000,
              selectedCheckoutId: 'checkout_hash-22',
              activeDiagramId: CANVAS,
              defaultMode: 'agent',
              durableMessages: ['must be ignored'],
              canvasViews: {
                [CANVAS]: { zoom: 20, pan: { x: 200_000, y: -200_000 }, fitted: false },
              },
            },
          },
        },
      },
    }));
    const scope = getWorkspaceScope(parsed, scopeId);
    expect(scope.openSessionIds).toEqual([SESSION_A]);
    expect(scope.views[SESSION_A]).toEqual({
      composer: 'draft',
      pendingAttachmentIds: [CANVAS],
      unread: 999,
      selectedCheckoutId: 'checkout_hash-22',
      activeDiagramId: CANVAS,
      defaultMode: 'agent',
      canvasViews: {
        [CANVAS]: { zoom: 8, pan: { x: 100_000, y: -100_000 }, fitted: false },
      },
    });
  });

  it('falls back safely for malformed or unsupported storage', () => {
    expect(parseDeviceWorkspace('{broken')).toEqual(EMPTY_DEVICE_WORKSPACE);
    expect(parseDeviceWorkspace('{"version":2,"scopes":{}}')).toEqual(EMPTY_DEVICE_WORKSPACE);
  });
});
