// Batches PCM on the audio thread; the output remains silent. No audio is stored here.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048);
    this.offset = 0;
    this.samples = 0;
    this.finished = false;
    this.port.onmessage = () => this.finish();
  }
  flush() {
    if (this.offset) this.port.postMessage(this.chunk.slice(0, this.offset));
    this.offset = 0;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.flush();
    this.port.postMessage('stopped');
  }
  process(inputs) {
    if (this.finished) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.chunk[this.offset++] = sample;
      this.samples++;
      if (this.offset === this.chunk.length) this.flush();
      if (this.samples >= sampleRate * 60) { this.finish(); return false; }
    }
    return true;
  }
}
registerProcessor('codeai-voice-capture', VoiceCapture);
