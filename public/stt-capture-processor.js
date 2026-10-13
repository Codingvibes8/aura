/**
 * AudioWorklet processor for Aura server-side STT (Phase 2).
 *
 * Captures microphone Float32 samples at the device sample rate,
 * downsamples to 16 kHz mono, converts to PCM16, and posts ~128 ms
 * chunks (2048 samples) to the main thread for WebSocket transport.
 *
 * Loaded via: audioContext.audioWorklet.addModule("/stt-capture-processor.js")
 */

class SttCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(0);
    this._inputRate = sampleRate; // AudioWorklet global: device rate
    this._targetRate = 16000;
  }

  _concat(a, b) {
    const out = new Int16Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  _downsampleToInt16(float32) {
    const ratio = this._inputRate / this._targetRate;
    const outLen = Math.floor(float32.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(i * ratio);
      const s = Math.max(-1, Math.min(1, float32[idx] || 0));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  process(inputs) {
    const channel = inputs && inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      const pcm = this._downsampleToInt16(channel);
      this._buffer = this._concat(this._buffer, pcm);
      // Emit 2048-sample (~128 ms) chunks
      while (this._buffer.length >= 2048) {
        const chunk = this._buffer.slice(0, 2048);
        this._buffer = this._buffer.slice(2048);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("aura-stt-capture", SttCaptureProcessor);
