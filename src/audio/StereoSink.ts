// StereoSink - raccoglie i campioni dei PSG e li ricampiona alla frequenza dell'uscita audio
//
// I PSG producono un campione per tick (clock/8, 125 kHz a 1 MHz). Qui si fa la media dei
// tick che cadono in ogni campione di uscita (filtro a finestra, abbastanza per togliere
// l'aliasing delle onde quadre) e si applica un passa-alto a ~20 Hz, come i condensatori
// di uscita degli LM386 della scheda audio.

export class StereoSink {
  /** frequenza dei campioni in ingresso (tick dei PSG) */
  inputRate = 125000;
  /** frequenza dell'uscita audio */
  outputRate = 48000;
  /** volume generale 0..1 */
  volume = 0.8;
  /** true = mescola sinistro e destro (uscita mono) */
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

  /** livello di picco dall'ultimo take() (per i VU meter) */
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
    // passa-alto a un polo (~20 Hz)
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

  /** campioni stereo interlacciati prodotti dall'ultima chiamata */
  take(): Float32Array {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }

  resetPeaks(): void {
    this.peakL = this.peakR = 0;
  }
}
