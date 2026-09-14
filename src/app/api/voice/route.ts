import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { reserveTranscription, transcribeVoice, voiceConfiguration } from '@/server/voice/transcription';
import { safeJsonResponse } from '@/shared/protocol';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, validVoiceWav } from '@/shared/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  try {
    const { origin, language } = voiceConfiguration();
    return safeJsonResponse({ configured: Boolean(origin), language, maxSeconds: MAX_VOICE_SECONDS });
  } catch { return safeJsonResponse({ error: 'Check voice configuration on the home machine.' }, { status: 503 }); }
}

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  if (request.headers.get('content-type') !== 'audio/wav') {
    return safeJsonResponse({ error: 'Voice requires PCM WAV audio.' }, { status: 415 });
  }
  let config: ReturnType<typeof voiceConfiguration>;
  try { config = voiceConfiguration(); } catch {
    return safeJsonResponse({ error: 'Check voice configuration on the home machine.' }, { status: 503 });
  }
  if (!config.origin) return safeJsonResponse({ error: 'Set up local Whisper on the home machine to use dictation.' }, { status: 503 });
  const release = reserveTranscription();
  if (!release) return safeJsonResponse({ error: 'Voice is busy. Wait for the previous clip to finish, then retry.' }, { status: 429 });
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = await boundedRequestBody(request, MAX_VOICE_BYTES, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])); } catch {
      return safeJsonResponse({ error: 'Voice clip is too large or could not be read.' }, { status: 413 });
    }
    if (!validVoiceWav(bytes)) return safeJsonResponse({ error: 'Voice clip must be mono PCM16 at 16 kHz, up to 60 seconds.' }, { status: 400 });
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const text = await transcribeVoice(bytes, config.origin, config.language, request.signal);
    // Authorization may be revoked while the local engine is working.
    const revoked = await authorizePersonalDeviceRequest(request);
    if (revoked) return revoked;
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return safeJsonResponse({ text });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return safeJsonResponse({ error: 'Transcription failed. Check Whisper on the home machine and retry.' }, { status: 503 });
  } finally { release(); }
}
