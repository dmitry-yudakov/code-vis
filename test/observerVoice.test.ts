import { afterEach, describe, expect, it, vi } from 'vitest';
import { runObserverVoice } from '@/features/observer/observerVoice';
import { observerCommand } from '@/features/observer/observerModel';

afterEach(() => vi.unstubAllGlobals());
function fixture(utterances = ['What needs me?', 'Tell login to continue', 'Send it', 'Stop listening']) {
  const track = Object.assign(new EventTarget(), { enabled: true, onended: null, stop: vi.fn() });
  const stream = { getTracks: () => [track] };
  const contexts: FakeContext[] = [];
  const nodes: FakeNode[] = [];
  let silence = false;
  class FakeNode {
    onprocessorerror = null;
    port = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn(),
      postMessage: () => queueMicrotask(() => this.port.onmessage?.({ data: 'stopped' })) };
    constructor() { nodes.push(this); }
    connect() { return this; }
    disconnect = vi.fn();
    play() {
      setTimeout(() => {
        for (let i = 0; i < (silence ? 120 : 18); i++) {
          const chunk = new Float32Array(2048); if (!silence && i < 3) chunk.fill(0.15);
          this.port.onmessage?.({ data: chunk });
        }
      }, 0);
    }
  }
  class FakeContext {
    sampleRate = 16_000; state = 'running'; destination = {}; onstatechange = null;
    audioWorklet = { addModule: vi.fn(async () => {}) };
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    constructor() { contexts.push(this); }
    createMediaStreamSource() { return { connect: (node: FakeNode) => { node.play(); return node; }, disconnect: vi.fn() }; }
  }
  const getUserMedia = vi.fn(async () => stream);
  const spoken: string[] = [];
  const synthesis = { getVoices: () => [{ name: 'Test voice', lang: 'en-US', localService: true }],
    cancel: vi.fn(), speak: (utterance: { text: string; onend?: () => void }) => {
      expect(track.enabled).toBe(false); spoken.push(utterance.text); queueMicrotask(() => utterance.onend?.());
    } };
  class Utterance { voice = undefined; onend = null; onerror = null; constructor(public text: string) {} }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('window', { AudioContext: FakeContext, AudioWorkletNode: FakeNode, speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance });
  vi.stubGlobal('AudioContext', FakeContext); vi.stubGlobal('AudioWorkletNode', FakeNode);
  vi.stubGlobal('speechSynthesis', synthesis); vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json({ configured: true, language: 'en' });
    expect(track.enabled).toBe(false);
    return Response.json({ text: utterances.shift() ?? 'Stop listening' });
  });
  vi.stubGlobal('fetch', fetcher);
  return { track, contexts, nodes, getUserMedia, spoken, fetcher, setSilence: () => { silence = true; } };
}

describe('Observer conversational voice', () => {
  it('runs three complete automatic turns after one microphone gesture and excludes playback from capture', async () => {
    const f = fixture();
    const onText = vi.fn(async text => { expect(f.track.enabled).toBe(false); return `Reply to ${text}`; });
    await runObserverVoice({ signal: new AbortController().signal, onText, status: vi.fn(), voice: vi.fn() });
    expect(onText).toHaveBeenCalledTimes(3);
    expect(f.spoken).toHaveLength(3);
    expect(f.getUserMedia).toHaveBeenCalledOnce();
    expect(f.contexts).toHaveLength(1);
    expect(f.nodes).toHaveLength(4);
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('never transcribes initial silence and releases capture with a visible resumption error', async () => {
    const f = fixture(); f.setSilence();
    await expect(runObserverVoice({ signal: new AbortController().signal, onText: vi.fn(), status: vi.fn(), voice: vi.fn() })).rejects.toThrow('silence');
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalledOnce();
  });

  it('releases microphone immediately on abandonment while inference finishes, without speaking later', async () => {
    const f = fixture(['What needs me?']);
    const controller = new AbortController();
    let finish!: (answer: string) => void;
    const onText = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const running = runObserverVoice({ signal: controller.signal, onText, status: vi.fn(), voice: vi.fn() });
    await vi.waitFor(() => expect(onText).toHaveBeenCalledOnce());
    controller.abort();
    expect(f.track.stop).toHaveBeenCalledOnce();
    finish('Late response');
    await expect(running).rejects.toBeDefined();
    expect(f.spoken).toHaveLength(0);
  });

  it('uses narrow confirmation commands rather than treating arbitrary affirmative text as a send', () => {
    expect(observerCommand('Send it.')).toBe('send');
    expect(observerCommand('yes, the other session is fine')).toBeUndefined();
    expect(observerCommand('Stop listening!')).toBe('stop');
  });

  it('detects microphone loss between clips while inference is pending', async () => {
    const f = fixture(['What needs me?']);
    const onText = vi.fn(() => new Promise<string>(() => {}));
    const running = runObserverVoice({ signal: new AbortController().signal, onText, status: vi.fn(), voice: vi.fn() });
    const rejected = expect(running).rejects.toThrow('Microphone disconnected');
    await vi.waitFor(() => expect(onText).toHaveBeenCalledOnce());
    f.track.dispatchEvent(new Event('ended'));
    await rejected;
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.spoken).toHaveLength(0);
  });
});
