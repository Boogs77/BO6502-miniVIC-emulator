// AY-3-8910 - Programmable Sound Generator
//
// Emulazione a livello di contatori interni, al ritmo di clock/8:
//   toni     3 canali, periodo a 12 bit, f = clock / (16 * TP)
//   rumore   LFSR a 17 bit, periodo a 5 bit, f = clock / (16 * NP)
//   inviluppo 16 passi, 16 forme (R13), periodo a 16 bit, passo = clock / (16 * EP)
//   mixer    R7: bit 0-2 toni spenti, bit 3-5 rumore spento (1 = spento)
//   volume   tabella logaritmica a 16 livelli misurata sul chip reale
//
// Il chip avanza con tick() (un tick = 8 clock del PSG): lo chiama la scheda audio, che
// porta i suoi chip al ciclo CPU corrente prima di ogni scrittura, cosi' i cambi di
// registro cadono nel punto giusto del suono. out[] contiene l'uscita dei 3 canali (0..1).

const REG_MASK = [0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF, 0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF];

/** livelli DAC dell'AY-3-8910 (normalizzati, misure di "ayumi") */
export const AY_LEVELS = [
  0.0, 0.00999465934234, 0.0144502937362, 0.0210574502174,
  0.0307011520562, 0.0455481803616, 0.0644998855573, 0.107362478065,
  0.126588845655, 0.20498970016, 0.292210269322, 0.372838941024,
  0.492530708782, 0.635324635691, 0.805584802014, 1.0,
];

export class AY38910 {
  readonly regs = new Uint8Array(16);
  /** registro selezionato dall'ultimo latch */
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

  /** uscita corrente dei 3 canali (0..1), aggiornata a ogni tick */
  readonly out = new Float32Array(3);

  /** canali silenziati dall'interfaccia (debug) */
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
    this.selected = v & 0x0F;   // i bit alti selezionano il chip (sempre 0 sull'AY standard)
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

  /** un tick = 8 clock del PSG */
  tick(): void {
    const r = this.regs;

    // toni: il contatore conta fino al periodo e inverte l'uscita
    for (let ch = 0; ch < 3; ch++) {
      const period = (r[ch * 2] | (r[ch * 2 + 1] << 8)) || 1;
      if (++this.toneCount[ch] >= period) {
        this.toneCount[ch] = 0;
        this.toneOut[ch] ^= 1;
      }
    }

    // rumore: avanza a clock/16
    this.noisePrescale ^= 1;
    if (this.noisePrescale) {
      const np = r[6] || 1;
      if (++this.noiseCount >= np) {
        this.noiseCount = 0;
        this.rng ^= (((this.rng & 1) ^ ((this.rng >> 3) & 1)) << 17);
        this.rng >>= 1;
      }
    }

    // inviluppo: un passo ogni 16*EP clock = 2*EP tick
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

    // mixer e volumi
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
