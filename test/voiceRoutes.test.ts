import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/voice/route';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { voiceConfiguration } from '@/server/voice/transcription';
import { encodeVoiceWav, MAX_VOICE_BYTES } from '@/shared/voice';

let credential: string;
let deviceId: string;
let dataDir: string;
const wav = () => encodeVoiceWav(new Float32Array(160));
function request(body: ArrayBuffer | ReadableStream<Uint8Array> = wav(), signal?: AbortSignal) {
  return new Request('https://codeai.test/api/voice', { method: 'POST', body, signal,
    headers: { Origin: 'https://codeai.test', 'x-codeai-internal-transport': 'voice-test',
      Cookie: `__Host-codeai-device=${credential}`, 'Content-Type': 'audio/wav' },
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}

describe.sequential('paired home voice route', () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-voice-'));
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired'); vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
    vi.stubEnv('CODEAI_DATA_DIR', dataDir); vi.stubEnv('CODEAI_WHISPER_ORIGIN', 'http://127.0.0.1:8178');
    vi.stubEnv('CODEAI_VOICE_LANGUAGE', 'en');
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'voice-test';
    const store = getDeviceAuthStore(dataDir);
    const challenge = await store.issuePairingCode();
    const paired = await store.pair(challenge.code, 'Headset');
    credential = paired.credential; deviceId = paired.device.id;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('requires paired HTTPS and the exact origin before reading audio', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const missing = request(); missing.headers.delete('Cookie');
    expect((await POST(missing)).status).toBe(401);
    const foreign = request(); foreign.headers.set('Origin', 'https://other.test');
    expect((await POST(foreign)).status).toBe(403);
    const insecure = request(); insecure.headers.delete('x-codeai-internal-transport');
    expect((await POST(insecure)).status).toBe(426);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates bounded streamed audio and refuses a non-local engine', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const wrongType = request(); wrongType.headers.set('Content-Type', 'text/plain');
    expect((await POST(wrongType)).status).toBe(415);
    expect((await POST(request(new ArrayBuffer(80)))).status).toBe(400);
    let cancelled = false;
    expect((await POST(request(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_VOICE_BYTES + 1)); },
      cancel() { cancelled = true; },
    })))).status).toBe(413);
    expect(cancelled).toBe(true);
    for (const origin of ['https://speech.example', 'http://localhost:8080', 'http://127.0.0.1:8080/private', 'http://user:pass@127.0.0.1']) {
      vi.stubEnv('CODEAI_WHISPER_ORIGIN', origin);
      expect(() => voiceConfiguration()).toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only WAV to local Whisper and returns bounded text', async () => {
    const fetch = vi.fn(async (url, options: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:8178/inference');
      expect(options.redirect).toBe('error');
      const form = options.body as FormData;
      expect(form.get('language')).toBe('en');
      expect(form.get('response_format')).toBe('json');
      expect(await (form.get('file') as Blob).arrayBuffer()).toEqual(wav());
      return Response.json({ text: '  Edit src/App.tsx\nKeep tests.  ' });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await (await POST(request())).json()).toEqual({ text: 'Edit src/App.tsx\nKeep tests.' });
    const status = await GET(request());
    expect(await status.json()).toEqual({ configured: true, language: 'en', maxSeconds: 60 });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: 'x'.repeat(8001) })));
    expect((await POST(request())).status).toBe(503);
  });

  it('holds admission during inference and suppresses results after cancellation or revocation', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const first = POST(request(wav(), controller.signal));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect((await POST(request())).status).toBe(429);
    finish(Response.json({ text: 'stale result' }));
    expect((await first).status).toBe(499);
    const second = POST(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await getDeviceAuthStore(dataDir).revoke(deviceId);
    finish(Response.json({ text: 'private result' }));
    expect((await second).status).toBe(401);
  });

  it('releases a stalled upload on abort without calling Whisper', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    let cancelled = false;
    const controller = new AbortController();
    const pending = POST(request(new ReadableStream({ cancel() { cancelled = true; } }), controller.signal));
    await vi.waitFor(() => expect((globalThis as typeof globalThis & { codeaiVoiceBusy?: boolean }).codeaiVoiceBusy).toBe(true));
    controller.abort();
    expect((await pending).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
