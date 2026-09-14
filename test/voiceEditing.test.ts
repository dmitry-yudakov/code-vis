import { describe, expect, it } from 'vitest';
import { draftTokens, editVoiceDraft, spellVoiceText } from '@/features/conversation/voiceEditing';
import { encodeVoiceWav, MAX_VOICE_BYTES, validVoiceWav, VOICE_SAMPLE_RATE } from '@/shared/voice';

describe('voice draft correction', () => {
  it('corrects an exact mixed-case path and multiline instruction without losing adjacent text', () => {
    const draft = 'Edit wrong/path\nKeep the tests.';
    const tokens = draftTokens(draft);
    expect(tokens.map((token) => token.text)).toEqual(['Edit', 'wrong/path', '\n', 'Keep', 'the', 'tests.']);
    const spelling = spellVoiceText('sierra romeo charlie slash capital alpha papa papa dot tango sierra xray');
    expect(spelling).toBe('src/App.tsx');
    expect(editVoiceDraft(draft, spelling, tokens[1])).toBe('Edit src/App.tsx\nKeep the tests.');
    expect(editVoiceDraft(draft, '', tokens[1])).toBe('Edit \nKeep the tests.');
    expect(editVoiceDraft(draft, '\n')).toBe(`${draft}\n`);
    expect(editVoiceDraft(draft, 'More.')).toBe(`${draft} More.`);
  });

  it('rejects uncertain spelling and overflow rather than silently changing an instruction', () => {
    expect(spellVoiceText('capital bravo underscore zero new line alpha')).toBe('B_0\na');
    expect(spellVoiceText('open bracket quote alpha quote close bracket')).toBe('["a"]');
    expect(() => spellVoiceText('mystery alphabet')).toThrow('did not recognize');
    expect(() => spellVoiceText('capital')).toThrow('letter after');
    expect(() => editVoiceDraft('x'.repeat(8000), 'more')).toThrow('8,000');
    const unicode = 'Edit 🙂/日本語';
    expect(editVoiceDraft(unicode, 'src/x', draftTokens(unicode)[1])).toBe('Edit src/x');
  });
});

describe('bounded capture audio', () => {
  it('encodes interoperable PCM16 WAV and rejects wrong rates, channels, sizes and formats', () => {
    const wav = encodeVoiceWav(new Float32Array([-2, -1, 0, 1, 2]));
    expect(validVoiceWav(new Uint8Array(wav))).toBe(true);
    const view = new DataView(wav);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
    for (const [offset, value] of [[22, 2], [24, 48000], [34, 32], [40, 4]]) {
      const changed = wav.slice(0);
      new DataView(changed).setUint16(offset, value, true);
      expect(validVoiceWav(new Uint8Array(changed))).toBe(false);
    }
    expect(validVoiceWav(new Uint8Array(wav.slice(1)))).toBe(false);
    expect(validVoiceWav(new Uint8Array(encodeVoiceWav(new Float32Array())))).toBe(false);
    const long = encodeVoiceWav(new Float32Array(VOICE_SAMPLE_RATE * 61));
    expect(long.byteLength).toBe(MAX_VOICE_BYTES);
    expect(validVoiceWav(new Uint8Array(long))).toBe(true);
  });
});
