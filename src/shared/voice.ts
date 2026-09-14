export const VOICE_SAMPLE_RATE = 16_000;
export const MAX_VOICE_SECONDS = 60;
export const MAX_VOICE_BYTES = 44 + VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS * 2;
export const MAX_DRAFT_LENGTH = 8_000;

/** The capture and route share a deliberately narrow mono, PCM16 WAV contract. */
export function encodeVoiceWav(samples: Float32Array): ArrayBuffer {
  const count = Math.min(samples.length, VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const label = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export function validVoiceWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 46 || bytes.byteLength > MAX_VOICE_BYTES || bytes.byteLength % 2) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset: number, value: string) => [...value].every((char, i) => view.getUint8(offset + i) === char.charCodeAt(0));
  return label(0, 'RIFF') && view.getUint32(4, true) === bytes.byteLength - 8 && label(8, 'WAVE')
    && label(12, 'fmt ') && view.getUint32(16, true) === 16 && view.getUint16(20, true) === 1
    && view.getUint16(22, true) === 1 && view.getUint32(24, true) === VOICE_SAMPLE_RATE
    && view.getUint32(28, true) === VOICE_SAMPLE_RATE * 2 && view.getUint16(32, true) === 2
    && view.getUint16(34, true) === 16 && label(36, 'data') && view.getUint32(40, true) === bytes.byteLength - 44;
}
