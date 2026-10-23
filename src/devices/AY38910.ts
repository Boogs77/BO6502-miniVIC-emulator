// AY-3-8910 - Programmable Sound Generator
//
// Emulation at the level of the internal counters, at a clock/8 rate:
//   tones    3 channels, 12-bit period, f = clock / (16 * TP)
//   noise    17-bit LFSR, 5-bit period, f = clock / (16 * NP)
//   envelope 16 steps, 16 shapes (R13), 16-bit period, step = clock / (16 * EP)
//   mixer    R7: bits 0-2 tones off, bits 3-5 noise off (1 = off)
//   volume   16-level logarithmic table measured on the real chip
//
// The chip advances with tick() (one tick = 8 PSG clocks): it is called by the audio board,
// which brings its chips to the current CPU cycle before every write, so register changes
// land at the right point of the sound. out[] holds the output of the 3 channels (0..1).

const REG_MASK = [0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF];

/** AY-3-8910 DAC levels (normalised, "ayumi" measurements) */
export const AY_LEVELS = [
  0.0, 0.00999465934234, 0.0144502937362, 0.0210574502174,
  0.0307011520562, 0.0455481803616, 0.0644998855573, 0.107362478065,
  0.126588845655, 0.20498970016, 0.292210269322, 0.372838941024,
  0.492530708782, 0.635324635691, 0.805584802014, 1.0,
];

export class AY38910 {
  readonly regs = new Uint8Array(16);
  /** register selected by the last latch */
  selected = 0;

  private toneCount = [0, 0, 0];
  private toneOut = [0, 0, 0];
  private noiseCount = 0;
  private noisePrescale = 0;
  private rng = 1;
  private envCount = 0;
  private envStep = 15;
  private envAttack = 0;
  private envHold = false;
  private envAlternate = false;
  private envHolding = false;
  private envVolume = 0;

  /** current output of the 3 channels (0..1), updated on every tick */
  readonly out = new Float32Array(3);

  /** channels muted from the UI (debug) */
  readonly muted = [false, false, false];

  reset(): void {
    this.regs.fill(0);
    this.selected = 0;
    this.toneCount = [0, 0, 0];
    this.toneOut = [0, 0, 0];
    this.noiseCount = 0;
    this.noisePrescale = 0;
    this.rng = 1;
    this.envCount = 0;
    this.writeReg(13, 0);
  }

  latch(v: number): void {
    this.selected = v & 0x0F;   // the high bits select the chip (always 0 on the standard AY)
  }

  writeData(v: number): void {
    this.writeReg(this.selected, v);
  }

  readData(): number {
    return this.regs[this.selected];
  }

  writeReg(r: number, v: number): void {
    this.regs[r] = v & REG_MASK[r];
    if (r === 13) {
      const shape = this.regs[13];
      this.envStep = 15;
      this.envHolding = false;
      this.envAttack = (shape & 0x04) ? 0x0F : 0x00;
      if (!(shape & 0x08)) {
        this.envHold = true;
        this.envAlternate = this.envAttack !== 0;
      } else {
        this.envHold = (shape & 0x01) !== 0;
        this.envAlternate = (shape & 0x02) !== 0;
      }
      this.envVolume = this.envStep ^ this.envAttack;
      this.envCount = 0;
    }
  }

  /** one tick = 8 PSG clocks */
  tick(): void {
    const r = this.regs;

    // tones: the counter counts up to the period and toggles the output
    for (let ch = 0; ch < 3; ch++) {
      const period = (r[ch * 2] | (r[ch * 2 + 1] << 8)) || 1;
      if (++this.toneCount[ch] >= period) {
        this.toneCount[ch] = 0;
        this.toneOut[ch] ^= 1;
      }
    }

    // noise: advances at clock/16
    this.noisePrescale ^= 1;
    if (this.noisePrescale) {
      const np = r[6] || 1;
      if (++this.noiseCount >= np) {
        this.noiseCount = 0;
        this.rng ^= (((this.rng & 1) ^ ((this.rng >> 3) & 1)) << 17);
        this.rng >>= 1;
      }
    }

    // envelope: one step every 16*EP clocks = 2*EP ticks
    const ep = (r[11] | (r[12] << 8)) || 1;
    if (++this.envCount >= ep * 2) {
      this.envCount = 0;
      if (!this.envHolding) {
        this.envStep--;
        if (this.envStep < 0) {
          if (this.envHold) {
            if (this.envAlternate) this.envAttack ^= 0x0F;
            this.envHolding = true;
            this.envStep = 0;
          } else {
            if (this.envAlternate) this.envAttack ^= 0x0F;
            this.envStep &= 0x0F;
          }
        }
      }
      this.envVolume = this.envStep ^ this.envAttack;
    }

    // mixer and volumes
    const mixer = r[7];
    const noise = this.rng & 1;
    for (let ch = 0; ch < 3; ch++) {
      const tone = this.toneOut[ch] | ((mixer >> ch) & 1);
      const nse = noise | ((mixer >> (ch + 3)) & 1);
      const vol = r[8 + ch];
      const level = (vol & 0x10) ? this.envVolume : vol & 0x0F;
      this.out[ch] = (tone & nse) && !this.muted[ch] ? AY_LEVELS[level] : 0;
    }
  }
}
