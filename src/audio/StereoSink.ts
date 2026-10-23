// StereoSink - collects the PSG samples and resamples them to the audio output rate
//
// The PSGs produce one sample per tick (clock/8, 125 kHz at 1 MHz). Here the ticks falling
// in each output sample are averaged (box filter, enough to remove the aliasing of the
// square waves) and a ~20 Hz high-pass is applied, like the output capacitors of the
// audio board LM386s.

export class StereoSink {
  /** input sample rate (PSG ticks) */
  inputRate = 125000;
  /** audio output sample rate */
  outputRate = 48000;
  /** master volume 0..1 */
  volume = 0.8;
  /** true = mix left and right (mono output) */
  mono = false;

  private accL = 0;
  private accR = 0;
  private accN = 0;
  private phase = 0;
  private hpL = 0;
  private hpR = 0;
  private lastInL = 0;
  private lastInR = 0;
  private buf = new Float32Array(8192);
  private len = 0;

  /** peak level since the last take() (for the VU meters) */
  peakL = 0;
  peakR = 0;

  push(l: number, r: number): void {
    this.accL += l;
    this.accR += r;
    this.accN++;
    this.phase += this.outputRate;
    if (this.phase < this.inputRate) return;
    this.phase -= this.inputRate;
    let L = this.accL / this.accN;
    let R = this.accR / this.accN;
    this.accL = this.accR = this.accN = 0;
    if (this.mono) L = R = (L + R) / 2;
    // one-pole high-pass (~20 Hz)
    const a = 1 / (1 + (2 * Math.PI * 20) / this.outputRate);
    this.hpL = a * (this.hpL + L - this.lastInL);
    this.hpR = a * (this.hpR + R - this.lastInR);
    this.lastInL = L;
    this.lastInR = R;
    const oL = this.hpL * this.volume;
    const oR = this.hpR * this.volume;
    if (Math.abs(oL) > this.peakL) this.peakL = Math.abs(oL);
    if (Math.abs(oR) > this.peakR) this.peakR = Math.abs(oR);
    if (this.len + 2 > this.buf.length) {
      const nb = new Float32Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.len++] = oL;
    this.buf[this.len++] = oR;
  }

  /** interleaved stereo samples produced since the last call */
  take(): Float32Array {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }

  resetPeaks(): void {
    this.peakL = this.peakR = 0;
  }
}
