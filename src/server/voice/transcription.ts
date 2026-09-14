import { rawSetting } from '@/server/config';
import { MAX_DRAFT_LENGTH } from '@/shared/voice';

export function voiceConfiguration() {
  const raw = rawSetting('WHISPER_ORIGIN');
  const language = rawSetting('VOICE_LANGUAGE') || 'en';
  if (!/^(auto|[a-z]{2,3})$/.test(language)) throw new Error('Invalid voice language configuration.');
  if (!raw) return { language };
  const origin = new URL(raw);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname)
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Whisper must use an HTTP loopback origin.');
  }
  return { origin: origin.origin, language };
}

// Keep one admission slot across Next route reloads. The documented Whisper version aborts
// inference when the upstream HTTP connection closes.
const state = globalThis as typeof globalThis & { codeaiVoiceBusy?: boolean };
export function reserveTranscription(): (() => void) | undefined {
  if (state.codeaiVoiceBusy) return;
  state.codeaiVoiceBusy = true;
  return () => { state.codeaiVoiceBusy = false; };
}

export async function transcribeVoice(bytes: Uint8Array<ArrayBuffer>, origin: string, language: string, signal?: AbortSignal): Promise<string> {
  const body = new FormData();
  body.set('file', new Blob([bytes], { type: 'audio/wav' }), 'dictation.wav');
  body.set('language', language);
  body.set('response_format', 'json');
  body.set('temperature', '0');
  body.set('no_timestamps', 'true');
  const response = await fetch(`${origin}/inference`, {
    method: 'POST', body, redirect: 'error',
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)]),
  });
  if (!response.ok || !response.body) throw new Error('Transcription failed. Check Whisper on the home machine and retry.');
  const reader = response.body.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) throw new Error('Transcription response is too large.');
      text += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string'
      || data.text.length > MAX_DRAFT_LENGTH) throw new Error('Invalid transcription response.');
    return data.text.trim();
  } finally { await reader.cancel().catch(() => undefined); }
}
