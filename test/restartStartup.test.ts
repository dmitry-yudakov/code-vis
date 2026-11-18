import { afterEach, describe, expect, it, vi } from 'vitest';
const recover = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
vi.mock('@/server/lifecycle/resumeSuspendedTurns', () => ({ resumeSuspendedTurns: recover }));
import { register } from '@/instrumentation';
import { runRegistry } from '@/server/runs/runRegistry';
import type { ManagedBridge } from '@/server/lifecycle/managedBridge';
import type { CodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';

const scope = globalThis as typeof globalThis & { __codeaiManagedLifecycle?: ManagedBridge; __codeAiLifecycle?: CodeAiLifecycle };
afterEach(() => {
  delete scope.__codeaiManagedLifecycle; delete scope.__codeAiLifecycle;
  runRegistry.releaseMaintenance(); recover.mockReset().mockResolvedValue(undefined); vi.unstubAllEnvs();
});

describe('restart startup readiness', () => {
  it('restores only after the supervisor accepts readiness, keeping admission held through recovery', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const listeners: Array<(message: unknown) => void> = [];
    scope.__codeaiManagedLifecycle = {
      init: { type: 'lifecycle-init', installationRoot: '/installation', slot: '.next', releaseId: 'candidate' },
      connected: () => true, send: vi.fn(), listen: listener => { listeners.push(listener); },
    };
    let release!: () => void;
    recover.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    await register();
    expect(recover).not.toHaveBeenCalled();
    const deliver = (phase: string) => listeners.forEach(listener => listener({ type: 'lifecycle-state', snapshot: {
      available: true, phase, releaseId: 'candidate',
    } }));
    deliver('restarting');
    expect(recover).not.toHaveBeenCalled();
    expect(runRegistry.acquireCheckoutWrite('/repo')).toBeUndefined();
    const read = runRegistry.acquireCheckoutRead('/repo');
    expect(read).toBeTypeOf('function'); read!();
    const reserve = () => runRegistry.reserve({ runId: crypto.randomUUID(), sessionId: 'session', participantId: 'agent',
      providerKey: 'provider', checkoutId: 'repo', access: 'read', cancel: vi.fn() });
    expect(reserve()).toEqual({ accepted: false, reason: 'maintenance' });
    deliver('idle');
    expect(recover).toHaveBeenCalledOnce();
    expect(reserve()).toEqual({ accepted: false, reason: 'maintenance' });
    release();
    await vi.waitFor(() => expect(runRegistry.acquireMaintenance()).toBe('acquired'));
    runRegistry.releaseMaintenance();
    deliver('idle');
    expect(recover).toHaveBeenCalledOnce();
  });

  it('also restores a manual unmanaged server startup', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(recover).toHaveBeenCalledOnce();
  });
});
