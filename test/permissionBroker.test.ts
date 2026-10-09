import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionBroker } from '@/server/runs/permissionBroker';

describe('PermissionBroker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['allow', 'deny'] as const)('keeps an unlimited request pending until a later %s decision', (decision) => {
    const broker = new PermissionBroker(0);
    const settle = vi.fn();
    broker.request('request', settle);

    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1_000);
    expect(settle).not.toHaveBeenCalled();
    expect(broker.pendingCount).toBe(1);
    expect(broker.decide('request', decision)).toBe(true);
    expect(settle).toHaveBeenCalledExactlyOnceWith(decision);
    expect(broker.pendingCount).toBe(0);
    expect(broker.decide('request', decision)).toBe(false);
    broker.cancelAll();
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('cancels unlimited requests and refuses late decisions and new requests', () => {
    const broker = new PermissionBroker(0);
    const first = vi.fn();
    const second = vi.fn();
    broker.request('first', first);
    broker.request('second', second);

    vi.advanceTimersByTime(3_600_001);
    broker.cancelAll();
    broker.cancelAll();
    expect(first).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(second).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(broker.pendingCount).toBe(0);
    expect(broker.decide('first', 'allow')).toBe(false);
    const late = vi.fn();
    broker.request('late', late);
    expect(late).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(broker.pendingCount).toBe(0);
  });

  it('cancels only the affected request and keeps the broker open', () => {
    const broker = new PermissionBroker(5_000);
    const cancelled = vi.fn();
    const pending = vi.fn();
    broker.request('child', cancelled);
    broker.request('parent', pending);

    expect(broker.cancel('child')).toBe(true);
    expect(cancelled).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(broker.cancel('child')).toBe(false);
    expect(broker.decide('child', 'allow')).toBe(false);
    expect(pending).not.toHaveBeenCalled();
    expect(broker.pendingCount).toBe(1);
    expect(broker.decide('parent', 'allow')).toBe(true);
    broker.request('next', pending);
    expect(broker.decide('next', 'deny')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(pending.mock.calls).toEqual([['allow'], ['deny']]);
  });

  it('still expires a finite request once and rejects a late answer', () => {
    const broker = new PermissionBroker(5_000);
    const settle = vi.fn();
    broker.request('request', settle);

    vi.advanceTimersByTime(4_999);
    expect(settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settle).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(broker.pendingCount).toBe(0);
    expect(broker.decide('request', 'allow')).toBe(false);
    broker.cancelAll();
    vi.advanceTimersByTime(10_000);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('cancels one request without closing unrelated or later requests', () => {
    const broker = new PermissionBroker(5_000);
    const child = vi.fn();
    const parent = vi.fn();
    broker.request('child', child);
    broker.request('parent', parent);

    broker.cancel('child');
    broker.cancel('child');
    broker.cancel('unknown');
    expect(child).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(parent).not.toHaveBeenCalled();
    expect(broker.pendingCount).toBe(1);
    expect(broker.decide('child', 'allow')).toBe(false);
    const later = vi.fn();
    broker.request('later', later);
    expect(broker.decide('parent', 'allow')).toBe(true);
    expect(broker.decide('later', 'deny')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).toHaveBeenCalledExactlyOnceWith('allow');
    expect(later).toHaveBeenCalledExactlyOnceWith('deny');
    expect(broker.pendingCount).toBe(0);
  });

  it.each(['allow', 'cancelled'] as const)('clears a finite expiry after %s', (resolution) => {
    const broker = new PermissionBroker(5_000);
    const settle = vi.fn();
    broker.request('request', settle);
    if (resolution === 'cancelled') broker.cancelAll();
    else broker.decide('request', resolution);

    vi.advanceTimersByTime(10_000);
    expect(settle).toHaveBeenCalledExactlyOnceWith(resolution);
    expect(broker.pendingCount).toBe(0);
  });
});
