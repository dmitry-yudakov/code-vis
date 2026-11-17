import { openVoiceInput, startVoiceCapture, type VoiceCapture, type VoiceInput } from '@/features/conversation/voiceCapture';
import { observerCommand } from './observerModel';

async function listen(input: VoiceInput, signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let capture: VoiceCapture | undefined;
    let finishing = false;
    let speechSeconds = 0;
    let lastSpeech = 0;
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    const finish = (error?: string) => {
      if (finishing || !capture) return;
      finishing = true;
      signal.removeEventListener('abort', abort);
      void capture.stop().then(wav => error ? reject(new Error(error)) : resolve(wav), reject);
    };
    void startVoiceCapture(signal, error => finish(error), (level, seconds) => {
      if (level > 0.08) { speechSeconds += 0.128; lastSpeech = seconds; }
      if (speechSeconds >= 0.25 && seconds - lastSpeech >= 1.2) finish();
      else if (speechSeconds < 0.25 && seconds >= 15) finish('Voice paused after silence. Select Voice to resume.');
    }, input).then(value => { capture = value; if (signal.aborted) abort(); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

function speak(text: string, voice: SpeechSynthesisVoice, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    const finish = (error?: Error) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      utterance.onend = null; utterance.onerror = null;
      if (error) { speechSynthesis.cancel(); reject(error); } else resolve();
    };
    const abort = () => finish(new Error('Voice stopped.'));
    const timer = setTimeout(() => finish(new Error('Speech playback stopped. Select Voice to resume.')), 120_000);
    signal.addEventListener('abort', abort, { once: true });
    utterance.onend = () => finish();
    utterance.onerror = () => finish(new Error('Speech playback failed. Select Voice to resume.'));
    if (signal.aborted) { abort(); return; }
    speechSynthesis.speak(utterance);
  });
}

async function voices(signal: AbortSignal): Promise<SpeechSynthesisVoice[]> {
  const available = speechSynthesis.getVoices();
  if (available.length) return available;
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); speechSynthesis.removeEventListener('voiceschanged', finish); signal.removeEventListener('abort', abort); resolve(speechSynthesis.getVoices()); };
    const abort = () => { finish(); reject(signal.reason); };
    const timer = setTimeout(finish, 2000);
    speechSynthesis.addEventListener('voiceschanged', finish);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Half-duplex: only the listening phase enables microphone tracks; playback never feeds input. */
export async function runObserverVoice(input: {
  signal: AbortSignal;
  onText(text: string): Promise<string>;
  status(text: string): void;
  voice(name: string): void;
}): Promise<void> {
  const { signal } = input;
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error('Spoken replies are unavailable in this browser. Use text.');
  const lifetime = new AbortController();
  const active = AbortSignal.any([signal, lifetime.signal]);
  let release = () => {};
  try {
    input.status('Starting microphone…');
    // Keep capture and AudioContext creation in the user's start gesture.
    const microphone = await openVoiceInput(active);
    const lost = () => lifetime.abort(new Error('Microphone disconnected. Reconnect it and select Voice to resume.'));
    microphone.stream.getTracks().forEach(track => track.addEventListener('ended', lost));
    release = () => microphone.stream.getTracks().forEach(track => track.removeEventListener('ended', lost));
    const response = await fetch('/api/voice', { cache: 'no-store', signal: active });
    const configuration = await response.json();
    if (!response.ok || !configuration.configured) throw new Error('Set up local Whisper on the home machine to use voice (README).');
    const choices = await voices(active);
    active.throwIfAborted();
    const matching = choices.filter(v => v.lang.startsWith(configuration.language || 'en'));
    const voice = matching.find(v => v.localService) ?? matching[0] ?? choices.find(v => v.localService) ?? choices[0];
    if (!voice) throw new Error('No speech voice is available on this device. Use text.');
    input.voice(`${voice.name} · ${voice.localService ? 'on device' : 'device speech service'}`);
    while (!active.aborted) {
      input.status('Listening…');
      const wav = await listen(microphone, active);
      active.throwIfAborted(); input.status('Transcribing…');
      const response = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav,
        signal: AbortSignal.any([active, AbortSignal.timeout(100_000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Transcription failed. Retry voice.');
      if (typeof data.text !== 'string' || data.text.length > 8000) throw new Error('Invalid transcription. Retry voice.');
      const text = data.text.trim();
      active.throwIfAborted();
      if (!text) continue;
      if (observerCommand(text) === 'stop') break;
      input.status('Thinking…');
      const answer = await new Promise<string>((resolve, reject) => {
        const abort = () => reject(active.reason);
        active.addEventListener('abort', abort, { once: true });
        if (active.aborted) { abort(); return; }
        void input.onText(text).then(resolve, reject).finally(() => active.removeEventListener('abort', abort));
      });
      active.throwIfAborted();
      if (answer) { input.status('Speaking…'); await speak(answer, voice, active); }
    }
  } finally { release(); lifetime.abort(); speechSynthesis.cancel(); }
}
