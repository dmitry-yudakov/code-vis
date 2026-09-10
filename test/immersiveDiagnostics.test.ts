import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function browser(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set('code-ai:device:v1:immersive-diagnostics', initial);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { userAgent: 'Diagnostic test browser' });
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('device-local VR diagnostics', () => {
  it('bounds the history, retains it after reload, and exports a copy containing only diagnostic fields', async () => {
    browser();
    const diagnostics = await import('@/features/shell/immersive/immersiveDiagnostics');
    for (let i = 0; i < 150; i++) diagnostics.recordImmersiveDiagnostic('sample', { controllers: i });
    diagnostics.recordImmersiveDiagnostic('session-ended', { controllers: 0, content: 'not diagnostic data' } as { controllers: number });
    const report = diagnostics.getImmersiveDiagnostics();
    expect(report.events).toHaveLength(diagnostics.MAX_IMMERSIVE_DIAGNOSTICS);
    expect(report.events.at(-1)).not.toHaveProperty('content');
    expect(report.events[0].controllers).toBe(31);
    report.events[0].controllers = 999;
    vi.resetModules();
    const reloaded = await import('@/features/shell/immersive/immersiveDiagnostics');
    expect(reloaded.getImmersiveDiagnostics().events[0].controllers).toBe(31);
    expect(reloaded.getImmersiveDiagnostics().events.at(-1)?.event).toBe('session-ended');
  });

  it.each(['invalid JSON', '[{"event":"sample"}]', 'x'.repeat(128_001)])('ignores malformed or oversized persisted history', async (raw) => {
    browser(raw);
    const diagnostics = await import('@/features/shell/immersive/immersiveDiagnostics');
    diagnostics.recordImmersiveDiagnostic('page-ready');
    expect(diagnostics.getImmersiveDiagnostics().events.map((event) => event.event)).toEqual(['page-ready']);
  });

  it('keeps an in-memory report when storage reads and writes are blocked', async () => {
    const storage = browser();
    storage.getItem.mockImplementation(() => { throw new Error('Storage unavailable'); });
    storage.setItem.mockImplementation(() => { throw new Error('Storage full'); });
    const diagnostics = await import('@/features/shell/immersive/immersiveDiagnostics');
    expect(() => diagnostics.recordImmersiveDiagnostic('entry-requested')).not.toThrow();
    expect(() => diagnostics.recordImmersiveDiagnostic('sample', { heapBytes: Infinity })).not.toThrow();
    expect(window.__CODEAI_VR_DIAGNOSTICS__!().events.map((event) => event.event)).toEqual(['entry-requested']);
  });
});
