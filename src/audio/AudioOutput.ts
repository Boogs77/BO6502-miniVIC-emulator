// AudioOutput - uscita stereo con Web Audio (AudioWorklet)
//
// L'emulatore produce blocchi di campioni interlacciati (L, R) per ogni frame e li manda
// al worklet, che li riproduce da una coda. Il worklet riporta quanti campioni ha in coda:
// l'emulatore lo usa per restare agganciato al clock della scheda audio del PC
// (un frame in piu' se la coda si svuota, uno in meno se si allunga troppo).

const WORKLET = `
class StereoStream extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.off = 0; this.avail = 0; this.n = 0;
    this.port.onmessage = e => {
      if (e.data === 'clear') { this.q = []; this.off = 0; this.avail = 0; return; }
      this.q.push(e.data); this.avail += e.data.length / 2;
      // coda troppo lunga (scheda in pausa, tab in background): scarta il vecchio
      while (this.avail > sampleRate * 0.3 && this.q.length > 1) {
        const b = this.q.shift(); this.avail -= (b.length - this.off) / 2; this.off = 0;
      }
    };
  }
  process(inputs, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L;
    for (let i = 0; i < L.length; i++) {
      if (!this.q.length) { L[i] = 0; R[i] = 0; continue; }
      const b = this.q[0];
      L[i] = b[this.off]; R[i] = b[this.off + 1];
      this.off += 2; this.avail--;
      if (this.off >= b.length) { this.q.shift(); this.off = 0; }
    }
    if (++this.n % 8 === 0) this.port.postMessage(this.avail);
    return true;
  }
}
registerProcessor('stereo-stream', StereoStream);
`;

export class AudioOutput {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  /** campioni in coda nel worklet (ultimo valore riportato) */
  queued = 0;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get running(): boolean {
    return this.ctx?.state === 'running' && this.node !== null;
  }

  /** va chiamata da un gesto dell'utente (click, tasto) */
  start(): Promise<void> {
    if (this.starting) {
      void this.ctx?.resume();
      return this.starting;
    }
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, 'stereo-stream', { outputChannelCount: [2] });
      node.port.onmessage = e => { this.queued = e.data as number; };
      node.connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;
      await ctx.resume();
    })();
    return this.starting;
  }

  push(samples: Float32Array): void {
    if (!this.node || samples.length === 0) return;
    this.node.port.postMessage(samples, [samples.buffer]);
    this.queued += samples.length / 2;
  }

  clear(): void {
    this.node?.port.postMessage('clear');
    this.queued = 0;
  }

  /** secondi di audio in coda */
  get buffered(): number {
    return this.queued / this.sampleRate;
  }
}
