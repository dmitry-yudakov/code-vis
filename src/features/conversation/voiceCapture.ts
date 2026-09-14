import { encodeVoiceWav, MAX_VOICE_SECONDS, VOICE_SAMPLE_RATE } from '@/shared/voice';

export interface VoiceCapture { stop(): Promise<ArrayBuffer>; }

/** The caller owns an abort signal from the moment microphone permission is requested. */
export async function startVoiceCapture(signal: AbortSignal, onLimit: (error?: string) => void,
  onActivity?: (level: number, seconds: number) => void): Promise<VoiceCapture> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
    throw new Error('Microphone capture is unavailable in this browser. Use trusted HTTPS and retry.');
  }
  signal.throwIfAborted();
  const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  let stream: MediaStream | undefined;
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let chunks: Float32Array[] = [];
  let count = 0;
  let stopped = false;
  let flush: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    context.onstatechange = null;
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    source?.disconnect();
    if (node) { node.onprocessorerror = null; node.port.onmessage = null; node.port.close(); node.disconnect(); }
    void context.close().catch(() => undefined);
    signal.removeEventListener('abort', abort);
  };
  const abort = () => { stopped = true; chunks = []; cleanup(); flush?.(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const resumed = context.resume();
    void resumed.catch(() => undefined); // Permission can be denied before the resume is awaited.
    // Keep getUserMedia in the controller gesture. Release any late permission grant on abort.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
    signal.throwIfAborted();
    await resumed;
    await context.audioWorklet.addModule('/voice-capture.js');
    signal.throwIfAborted();
    if (context.sampleRate !== VOICE_SAMPLE_RATE) throw new Error('This browser cannot capture voice at 16 kHz.');
    node = new AudioWorkletNode(context, 'codeai-voice-capture');
    node.onprocessorerror = () => onLimit('Microphone processing failed. Retry dictation.');
    node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
      if (data === 'stopped') { if (flush) flush(); else onLimit(); }
      else if (!stopped && data instanceof Float32Array) {
        const chunk = data.slice(0, Math.max(0, VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS - count));
        chunks.push(chunk); count += chunk.length;
        const energy = chunk.reduce((total, sample) => total + sample * sample, 0);
        onActivity?.(Math.min(1, Math.sqrt(energy / Math.max(1, chunk.length)) * 8), count / VOICE_SAMPLE_RATE);
      }
    };
    stream.getTracks().forEach((track) => { track.onended = () => onLimit('Microphone disconnected. Reconnect it and retry dictation.'); });
    context.onstatechange = () => {
      if (context.state !== 'running' && !stopped && !signal.aborted) onLimit('Microphone paused. Resume the browser and retry dictation.');
    };
    source = context.createMediaStreamSource(stream);
    source.connect(node).connect(context.destination);
    timer = setTimeout(onLimit, MAX_VOICE_SECONDS * 1000);
    return {
      async stop() {
        if (stopped) throw new Error('Recording has already stopped.');
        clearTimeout(timer);
        await new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 300);
          flush = () => { clearTimeout(fallback); resolve(); };
          node?.port.postMessage('stop');
        });
        signal.throwIfAborted();
        stopped = true;
        cleanup();
        const samples = new Float32Array(count);
        let offset = 0;
        for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
        chunks = [];
        if (!count) throw new Error('No microphone audio was captured. Check microphone access and retry.');
        return encodeVoiceWav(samples);
      },
    };
  } catch (error) { cleanup(); throw error; }
}
