import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AUTO_REPORTS_PER_DOCUMENT, MIN_AUTO_REPORT_INTERVAL_MS,
} from '@/features/shell/immersive/immersiveReport';
import { immersiveReportSchema, MAX_IMMERSIVE_REPORT_ERRORS } from '@/shared/immersiveReport';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

function browser(ok = true) {
  const stored = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { userAgent: 'Quest Browser test' });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
  vi.stubGlobal('performance', { timeOrigin: 1_000 });
  const fetch = vi.fn(async () => new Response(JSON.stringify({ name: 'stored' }), { status: ok ? 200 : 503 }));
  vi.stubGlobal('fetch', fetch);
  return { fetch, stored };
}

function bodies(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe('immersive reporting from the headset', () => {
  it('keeps error text in memory, forwards it, and leaves device storage message-free', async () => {
    const { fetch, stored } = browser();
    const module = await import('@/features/shell/immersive/immersiveReport');
    module.setImmersiveReportContext({ view: 'home:project:session', availability: 'active' });
    module.noteImmersiveError('window-error', {
      message: 'panel is undefined', filename: 'https://codeai.test/vr.js', lineno: 42,
    });
    expect(module.immersiveErrorTail()).toEqual([expect.objectContaining({
      kind: 'window-error', message: 'panel is undefined (https://codeai.test/vr.js:42)',
    })]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/immersive/report');
    expect(init.method).toBe('POST');
    const report = immersiveReportSchema.safeParse(JSON.parse(String(init.body)));
    expect(report.success).toBe(true);
    expect(report.data).toMatchObject({
      kind: 'error', view: 'home:project:session', availability: 'active',
      browser: 'Quest Browser test', errors: [expect.objectContaining({ message: 'panel is undefined (https://codeai.test/vr.js:42)' })],
    });
    expect(JSON.stringify([...stored.values()])).not.toContain('panel is undefined');
  });

  it('describes errors, rejections, and strings, and bounds the retained tail', async () => {
    browser();
    const module = await import('@/features/shell/immersive/immersiveReport');
    module.noteImmersiveError('renderer-error', new TypeError('bad uniform'), false);
    module.noteImmersiveError('unhandled-rejection', { reason: new Error('late transcript') }, false);
    module.noteImmersiveError('webgl-context-lost', 'The WebGL context was lost.', false);
    expect(module.immersiveErrorTail().map((error) => error.message)).toEqual([
      'TypeError: bad uniform', 'Error: late transcript', 'The WebGL context was lost.',
    ]);
    expect(module.immersiveErrorTail()[0].stack).toContain('bad uniform');
    for (let index = 0; index < MAX_IMMERSIVE_REPORT_ERRORS + 5; index++) {
      module.noteImmersiveError('window-error', `failure ${index}`, false);
    }
    const tail = module.immersiveErrorTail();
    expect(tail).toHaveLength(MAX_IMMERSIVE_REPORT_ERRORS);
    expect(tail.at(-1)?.message).toBe(`failure ${MAX_IMMERSIVE_REPORT_ERRORS + 4}`);
  });

  it('rate-limits and caps automatic reports so a repeating failure cannot flood the link', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fetch } = browser();
    const module = await import('@/features/shell/immersive/immersiveReport');
    module.noteImmersiveError('window-error', 'first');
    module.noteImmersiveError('window-error', 'immediately after');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(MIN_AUTO_REPORT_INTERVAL_MS);
    module.noteImmersiveError('window-error', 'after the interval');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    for (let index = 0; index < MAX_AUTO_REPORTS_PER_DOCUMENT + 5; index++) {
      vi.advanceTimersByTime(MIN_AUTO_REPORT_INTERVAL_MS);
      module.noteImmersiveError('window-error', `repeat ${index}`);
    }
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(MAX_AUTO_REPORTS_PER_DOCUMENT));
    // A report the reporter asked for is never dropped by the automatic budget.
    expect(await module.sendImmersiveReport({ kind: 'capture', note: 'Reported from the workspace' })).toEqual({ outcome: 'sent' });
    expect(fetch).toHaveBeenCalledTimes(MAX_AUTO_REPORTS_PER_DOCUMENT + 1);
  });

  it('records the selection as the report is sent and returns the stored summary', async () => {
    const { fetch } = browser();
    const summary = { id: '2026-09-21T18-12-03.123Z-capture', receivedAt: '2026-09-21T18:12:03.123Z', kind: 'capture', errorCount: 0, screenshot: true };
    fetch.mockImplementation(async () => new Response(JSON.stringify({ name: summary.id, summary })));
    const module = await import('@/features/shell/immersive/immersiveReport');
    const selection = { machineId: crypto.randomUUID(), projectId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    module.setImmersiveReportContext({ selection: { ...selection, sessionId: crypto.randomUUID() } });
    module.setImmersiveReportContext({ selection });
    expect(await module.sendImmersiveReport({ kind: 'capture', screenshot: '/9j/' })).toEqual({ outcome: 'sent', summary });
    module.setImmersiveReportContext({ selection: { machineId: selection.machineId } });
    await module.sendImmersiveReport({ kind: 'capture' });
    expect(bodies(fetch).map((body) => body.context)).toEqual([selection, { machineId: selection.machineId }]);
  });

  it('carries the screenshot and records a diagnostic when the upload fails', async () => {
    const { fetch } = browser(false);
    const module = await import('@/features/shell/immersive/immersiveReport');
    const diagnostics = await import('@/features/shell/immersive/immersiveDiagnostics');
    expect(await module.sendImmersiveReport({ kind: 'capture', screenshot: '/9j/', note: 'Reported from the workspace' })).toEqual({ outcome: 'failed' });
    expect(bodies(fetch)[0]).toMatchObject({ kind: 'capture', screenshot: '/9j/' });
    expect(diagnostics.getImmersiveDiagnostics().events.map((event) => event.event)).toContain('report-failed');
  });
});
