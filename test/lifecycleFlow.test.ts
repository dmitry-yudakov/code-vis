import { describe, expect, it } from 'vitest';
import {
  INITIAL_LIFECYCLE, RECONNECT_LIMIT_MS, lifecycleConfirmation, lifecyclePollDelay, lifecycleReducer, lifecycleView,
  type LifecycleEvent, type LifecycleFlow,
} from '@/features/lifecycle/lifecycleFlow';
import type { AvailableLifecycleSnapshot } from '@/shared/codeAiLifecycle';

const OPERATION = '5b0c9a1e-3f4d-4e2a-9b1c-2d3e4f5a6b7c';
const idle: AvailableLifecycleSnapshot = { available: true, phase: 'idle', releaseId: 'release-a' };
const building: AvailableLifecycleSnapshot = {
  available: true, phase: 'building', releaseId: 'release-a', operationId: OPERATION, startedAt: '2026-09-23T10:00:00.000Z',
};
const restarting: AvailableLifecycleSnapshot = { ...building, phase: 'restarting', candidateReleaseId: 'release-b' };
const finished = (outcome: 'succeeded' | 'build-failed' | 'rolled-back', releaseId: string, detail?: string): AvailableLifecycleSnapshot => ({
  available: true, phase: 'idle', releaseId,
  lastOperation: { operationId: OPERATION, outcome, finishedAt: '2026-09-23T10:03:00.000Z', ...(detail ? { detail } : {}) },
});

const run = (events: LifecycleEvent[], from: LifecycleFlow = INITIAL_LIFECYCLE) => events.reduce(lifecycleReducer, from);
const seen = (snapshot: AvailableLifecycleSnapshot): LifecycleEvent => ({ type: 'snapshot', snapshot });

describe('the build-and-restart sequence', () => {
  it('needs an explicit ask and a second, confirming activation before anything is sent', () => {
    const shown = run([seen(idle)]);
    expect(lifecycleView(shown, 0)).toMatchObject({ available: true, canRequest: true, busy: false });
    expect(run([{ type: 'confirm' }], shown).submitting).toBe(false);
    const asked = run([{ type: 'ask' }], shown);
    expect(asked.confirming).toBe(true);
    expect(run([{ type: 'dismiss' }], asked)).toMatchObject({ confirming: false, submitting: false });
    expect(run([{ type: 'confirm' }], asked)).toMatchObject({ confirming: false, submitting: true });
    // Nothing to ask for on an unmanaged server or another project.
    for (const reason of ['not-managed', 'not-self-project'] as const) {
      const unavailable = run([{ type: 'snapshot', snapshot: { available: false, reason } }, { type: 'ask' }]);
      expect(unavailable.confirming).toBe(false);
      expect(lifecycleView(unavailable, 0).available).toBe(false);
    }
  });

  it('shows the build with its elapsed time, then waits through the restart and reloads on the new release', () => {
    const accepted = run([seen(idle), { type: 'ask' }, { type: 'confirm' }, { type: 'accepted', snapshot: building }]);
    expect(accepted.watch).toEqual({ operationId: OPERATION, formerReleaseId: 'release-a', restarting: false, failures: 0 });
    const view = lifecycleView(accepted, Date.parse('2026-09-23T10:01:05.000Z'));
    expect(view).toMatchObject({ busy: true, canRequest: false });
    expect(view.status).toContain('Building CodeAI · 1:05');
    expect(view.badge).toBe('Building CodeAI · 1:05');
    expect(lifecyclePollDelay(accepted)).toBe(2_000);

    // A request that fails while building is not a restart: the next building answer shows the build again.
    const blip = run([{ type: 'unreachable', at: 500 }], accepted);
    expect(lifecycleView(blip, 0).status).toContain('Restarting CodeAI');
    const recovered = run([seen(building)], blip);
    expect(recovered.watch).toMatchObject({ restarting: false, failures: 0 });
    expect(lifecycleView(recovered, Date.parse('2026-09-23T10:01:05.000Z')).status).toContain('Building CodeAI · 1:05');
    expect(lifecyclePollDelay(recovered)).toBe(2_000);

    const gone = run([seen(restarting), { type: 'unreachable', at: 1_000 }, { type: 'unreachable', at: 2_000 }], accepted);
    expect(gone.watch).toMatchObject({ restarting: true, failures: 2 });
    expect(lifecycleView(gone, 0).status).toContain('Restarting CodeAI');
    expect(gone.reload).toBe(false);
    // The old server still answering after announcing the restart is not the outcome.
    expect(run([seen(restarting)], gone).reload).toBe(false);
    expect(run([seen(finished('succeeded', 'release-b'))], gone)).toMatchObject({ reload: true, watch: undefined });
  });

  it('reloads after a rollback too, and after a restart that recorded no outcome for this operation', () => {
    const watching = run([seen(idle), { type: 'ask' }, { type: 'confirm' }, { type: 'accepted', snapshot: building }, seen(restarting)]);
    expect(run([seen(finished('rolled-back', 'release-a'))], watching).reload).toBe(true);
    expect(run([seen({ ...idle, releaseId: 'release-a' })], watching).reload).toBe(true);
    // A server that answers after the old one went away is new, even one that no longer offers this.
    expect(run([{ type: 'snapshot', snapshot: { available: false, reason: 'not-self-project' } }], watching).reload).toBe(true);
    const stillBuilding = run([seen(idle), { type: 'accepted', snapshot: building }]);
    expect(run([{ type: 'snapshot', snapshot: { available: false, reason: 'not-self-project' } }], stillBuilding))
      .toMatchObject({ reload: false, watch: undefined });
  });

  it('keeps the page when the build fails and says so from the recorded outcome', () => {
    const watching = run([seen(idle), { type: 'ask' }, { type: 'confirm' }, { type: 'accepted', snapshot: building }]);
    const failed = run([seen(finished('build-failed', 'release-a', 'The build failed with exit code 1.'))], watching);
    expect(failed).toMatchObject({ reload: false, watch: undefined });
    const view = lifecycleView(failed, 0);
    expect(view).toMatchObject({ busy: false, canRequest: true });
    expect(view.status).toContain('The build failed with exit code 1.');
    expect(lifecyclePollDelay(failed)).toBeUndefined();
  });

  it('follows an operation it did not start, as after reloading this page mid-build', () => {
    const adopted = run([seen(building)]);
    expect(adopted.watch).toMatchObject({ operationId: OPERATION, formerReleaseId: 'release-a' });
    expect(lifecycleView(adopted, 0).busy).toBe(true);
    expect(run([{ type: 'unreachable', at: 0 }, seen(finished('succeeded', 'release-b'))], adopted).reload).toBe(true);
  });

  it('backs off while CodeAI is away and gives up after a bounded time', () => {
    let flow = run([seen(idle), { type: 'accepted', snapshot: building }, seen(restarting)]);
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      flow = lifecycleReducer(flow, { type: 'unreachable', at: attempt * 1_000 });
      delays.push(lifecyclePollDelay(flow)!);
    }
    expect(delays[0]).toBeGreaterThanOrEqual(1_000);
    expect(delays.every((delay, index) => index === 0 || delay >= delays[index - 1])).toBe(true);
    expect(Math.max(...delays)).toBeLessThanOrEqual(5_000);
    const abandoned = lifecycleReducer(flow, { type: 'unreachable', at: RECONNECT_LIMIT_MS + 1 });
    expect(abandoned).toMatchObject({ watch: undefined, reload: false });
    expect(abandoned.error).toContain('did not come back');
    expect(lifecyclePollDelay(abandoned)).toBeUndefined();
  });

  it('reports a refused request without watching anything, until the server says more', () => {
    const refused = run([seen(idle), { type: 'ask' }, { type: 'confirm' }, { type: 'rejected', message: 'Agent turns are queued or running.' }]);
    expect(refused).toMatchObject({ submitting: false, error: 'Agent turns are queued or running.' });
    expect(refused.watch).toBeUndefined();
    expect(lifecycleView(refused, 0)).toMatchObject({ canRequest: true, status: 'Agent turns are queued or running.' });
    // A build another device started shows its progress, not the old refusal.
    const adopted = run([seen(building)], refused);
    expect(lifecycleView(adopted, Date.parse('2026-09-23T10:00:30.000Z'))).toMatchObject({ busy: true, badge: 'Building CodeAI · 0:30' });
    // And the answer after giving up on a restart replaces the give-up message.
    let away = run([seen(restarting)], adopted);
    away = lifecycleReducer(away, { type: 'unreachable', at: 0 });
    away = lifecycleReducer(away, { type: 'unreachable', at: RECONNECT_LIMIT_MS + 1 });
    expect(lifecycleView(away, 0).status).toContain('did not come back');
    expect(lifecycleView(run([seen(idle)], away), 0).status).toBe('Serving release release-a.');
  });

  it('names the checkout, the local execution, and the end of a VR session in its confirmation', () => {
    const text = lifecycleConfirmation('code-ai');
    expect(text).toContain('code-ai');
    expect(text).toContain('runs it on this machine');
    expect(text).toContain('VR session ends');
  });
});
