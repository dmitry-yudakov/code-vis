import { z } from 'zod';

export const IMMERSIVE_DIAGNOSTICS_KEY = 'code-ai:device:v1:immersive-diagnostics';
export const MAX_IMMERSIVE_DIAGNOSTICS = 120;

const count = z.number().finite().nonnegative();
const snapshot = z.object({
  visibility: z.enum(['visible', 'visible-blurred', 'hidden']).optional(),
  controllers: count.optional(),
  textures: count.optional(),
  geometries: count.optional(),
  programs: count.optional(),
  heapBytes: count.optional(),
  sessionActive: z.boolean().optional(),
  frames: count.optional(),
  medianFrameMs: count.optional(),
  p95FrameMs: count.optional(),
  logicalTexturePixels: count.optional(),
  liveResources: count.optional(),
});
const entry = snapshot.extend({
  at: z.string().datetime(),
  pageStartedAt: count,
  event: z.enum([
    'page-ready', 'entry-requested', 'entry-failed', 'entry-abandoned', 'session-started',
    'visibility-changed', 'controllers-changed', 'sample', 'exit-requested', 'session-ended',
    'end-failed', 'webgl-context-lost', 'webgl-context-restored', 'pagehide', 'renderer-unmounted',
    'renderer-error', 'window-error', 'unhandled-rejection',
  ]),
});
type DiagnosticEntry = z.infer<typeof entry>;
type DiagnosticSnapshot = z.infer<typeof snapshot>;
let history: DiagnosticEntry[] | undefined;

function readHistory(): DiagnosticEntry[] {
  if (history) return history;
  history = [];
  try {
    const raw = localStorage.getItem(IMMERSIVE_DIAGNOSTICS_KEY);
    if (raw && raw.length <= 128_000) {
      const parsed = z.array(entry).max(MAX_IMMERSIVE_DIAGNOSTICS).safeParse(JSON.parse(raw));
      if (parsed.success) history = parsed.data;
    }
  } catch { /* Diagnostics remain usable in memory when device storage is unavailable. */ }
  return history;
}

/** Diagnostic fields only: never persist error messages, content, URLs, identities, or poses. */
export function recordImmersiveDiagnostic(event: DiagnosticEntry['event'], details: DiagnosticSnapshot = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const value = entry.safeParse({
      ...window.__CODEAI_IMMERSIVE_INSTRUMENTATION__, ...details,
      at: new Date().toISOString(), pageStartedAt: performance.timeOrigin, event,
    });
    if (!value.success) return;
    const events = readHistory();
    events.push(value.data);
    events.splice(0, Math.max(0, events.length - MAX_IMMERSIVE_DIAGNOSTICS));
    window.__CODEAI_VR_DIAGNOSTICS__ = getImmersiveDiagnostics;
    localStorage.setItem(IMMERSIVE_DIAGNOSTICS_KEY, JSON.stringify(events));
  } catch { /* Logging must never interrupt XR, including when storage is full or blocked. */ }
}

export function getImmersiveDiagnostics() {
  return { version: 1, browser: navigator.userAgent, events: readHistory().map((item) => ({ ...item })) };
}

declare global {
  interface Window {
    __CODEAI_VR_DIAGNOSTICS__?: typeof getImmersiveDiagnostics;
  }
}
