// W65C22 VIA - Versatile Interface Adapter
//
//   porte A/B con DDR: lettura = (OR & DDR) | (pin & ~DDR)
//   CA1/CB1 ingressi di controllo (fronte scelto da PCR), CA2/CB2 in modo ingresso
//   T1 one-shot / free-run con uscita su PB7, T2 one-shot (conteggio impulsi non usato)
//   SR memorizzato (nessuno scorrimento: non usato dalle schede BO6502)
//   IFR / IER e linea IRQ (attiva quando IFR & IER != 0)
// Le periferiche collegate leggono le uscite con portA()/portB() e forniscono gli
// ingressi con inputA/inputB; i cambi di uscita arrivano in onPortAChange/onPortBChange.

export const IFR_CA2 = 0x01;
export const IFR_CA1 = 0x02;
export const IFR_SR = 0x04;
export const IFR_CB2 = 0x08;
export const IFR_CB1 = 0x10;
export const IFR_T2 = 0x20;
export const IFR_T1 = 0x40;

export class VIA6522 {
  ora = 0;
  orb = 0;
  ddra = 0;
  ddrb = 0;
  acr = 0;
  pcr = 0;
  ifr = 0;
  ier = 0;
  sr = 0;

  t1Counter = 0xFFFF;
  t1Latch = 0xFFFF;
  t2Counter = 0xFFFF;
  t2LatchLo = 0xFF;
  private t1Running = false;
  private t2Running = false;
  private pb7 = 1;

  /** livello dei pin in ingresso (le periferiche li impostano; 1 = alto) */
  inputA = 0xFF;
  inputB = 0xFF;

  onPortAChange: (value: number) => void = () => {};
  onPortBChange: (value: number) => void = () => {};
  /** chiamata quando cambia la linea IRQ */
  onIrq: (active: boolean) => void = () => {};

  private irqLine = false;
  private ca1 = 1;
  private cb1 = 1;

  reset(): void {
    this.ora = this.orb = this.ddra = this.ddrb = 0;
    this.acr = this.pcr = this.ifr = this.ier = this.sr = 0;
    this.t1Running = this.t2Running = false;
    this.pb7 = 1;
    this.updateIrq();
    this.onPortAChange(this.portA());
    this.onPortBChange(this.portB());
  }

  /** valore sui pin della porta A (uscite + ingressi) */
  portA(): number {
    return ((this.ora & this.ddra) | (this.inputA & ~this.ddra)) & 0xFF;
  }

  portB(): number {
    let v = ((this.orb & this.ddrb) | (this.inputB & ~this.ddrb)) & 0xFF;
    if (this.acr & 0x80) v = (v & 0x7F) | (this.pb7 << 7);
    return v;
  }

  /** linea CA1 dall'esterno: genera l'interrupt sul fronte scelto da PCR bit 0 */
  setCA1(level: number): void {
    level = level ? 1 : 0;
    if (level === this.ca1) return;
    const positive = (this.pcr & 0x01) !== 0;
    if ((positive && level) || (!positive && !level)) this.setIfr(IFR_CA1);
    this.ca1 = level;
  }

  setCB1(level: number): void {
    level = level ? 1 : 0;
    if (level === this.cb1) return;
    const positive = (this.pcr & 0x10) !== 0;
    if ((positive && level) || (!positive && !level)) this.setIfr(IFR_CB1);
    this.cb1 = level;
  }

  /** impulso su CA1 (fronte attivo e ritorno) */
  pulseCA1(): void {
    const positive = (this.pcr & 0x01) !== 0;
    this.setCA1(positive ? 0 : 1);
    this.setCA1(positive ? 1 : 0);
  }

  // ---------------- registri ----------------
  read(reg: number): number {
    switch (reg & 0x0F) {
      case 0x0: {
        this.clearIfr(IFR_CB1 | ((this.pcr & 0xA0) === 0x20 ? 0 : IFR_CB2));
        // i bit in uscita si leggono dal registro, gli ingressi dai pin
        return ((this.orb & this.ddrb) | (this.portB() & ~this.ddrb)) & 0xFF;
      }
      case 0x1:
        this.clearIfr(IFR_CA1 | ((this.pcr & 0x0A) === 0x02 ? 0 : IFR_CA2));
        return this.portA();
      case 0x2: return this.ddrb;
      case 0x3: return this.ddra;
      case 0x4: this.clearIfr(IFR_T1); return this.t1Counter & 0xFF;
      case 0x5: return this.t1Counter >> 8;
      case 0x6: return this.t1Latch & 0xFF;
      case 0x7: return this.t1Latch >> 8;
      case 0x8: this.clearIfr(IFR_T2); return this.t2Counter & 0xFF;
      case 0x9: return this.t2Counter >> 8;
      case 0xA: this.clearIfr(IFR_SR); return this.sr;
      case 0xB: return this.acr;
      case 0xC: return this.pcr;
      case 0xD: return this.ifr | (this.ifr & this.ier & 0x7F ? 0x80 : 0);
      case 0xE: return this.ier | 0x80;
      default: return this.portA(); // 0xF: ORA senza handshake
    }
  }

  /** lettura senza effetti collaterali (debugger) */
  peek(reg: number): number {
    switch (reg & 0x0F) {
      case 0x0: return this.portB();
      case 0x1: case 0xF: return this.portA();
      case 0xD: return this.ifr | (this.ifr & this.ier & 0x7F ? 0x80 : 0);
      case 0xE: return this.ier | 0x80;
      case 0x4: return this.t1Counter & 0xFF;
      case 0x8: return this.t2Counter & 0xFF;
      case 0xA: return this.sr;
      default: return this.read(reg);
    }
  }

  write(reg: number, v: number): void {
    switch (reg & 0x0F) {
      case 0x0:
        this.orb = v;
        this.clearIfr(IFR_CB1 | ((this.pcr & 0xA0) === 0x20 ? 0 : IFR_CB2));
        this.onPortBChange(this.portB());
        break;
      case 0x1:
        this.ora = v;
        this.clearIfr(IFR_CA1 | ((this.pcr & 0x0A) === 0x02 ? 0 : IFR_CA2));
        this.onPortAChange(this.portA());
        break;
      case 0x2: this.ddrb = v; this.onPortBChange(this.portB()); break;
      case 0x3: this.ddra = v; this.onPortAChange(this.portA()); break;
      case 0x4: case 0x6: this.t1Latch = (this.t1Latch & 0xFF00) | v; break;
      case 0x5:
        this.t1Latch = (this.t1Latch & 0x00FF) | (v << 8);
        this.t1Counter = this.t1Latch;
        this.clearIfr(IFR_T1);
        this.t1Running = true;
        if (this.acr & 0x80) { this.pb7 = 0; this.onPortBChange(this.portB()); }
        break;
      case 0x7:
        this.t1Latch = (this.t1Latch & 0x00FF) | (v << 8);
        this.clearIfr(IFR_T1);
        break;
      case 0x8: this.t2LatchLo = v; break;
      case 0x9:
        this.t2Counter = this.t2LatchLo | (v << 8);
        this.clearIfr(IFR_T2);
        this.t2Running = true;
        break;
      case 0xA: this.sr = v; this.clearIfr(IFR_SR); break;
      case 0xB: this.acr = v; this.onPortBChange(this.portB()); break;
      case 0xC: this.pcr = v; break;
      case 0xD: this.clearIfr(v & 0x7F); break;
      case 0xE:
        if (v & 0x80) this.ier |= v & 0x7F;
        else this.ier &= ~v & 0x7F;
        this.updateIrq();
        break;
      case 0xF: this.ora = v; this.onPortAChange(this.portA()); break;
    }
  }

  /** fa avanzare i timer di n cicli di PHI2 */
  tick(n: number): void {
    // T1
    let c = this.t1Counter - n;
    if (c < -1) {
      if (this.t1Running) {
        this.setIfr(IFR_T1);
        if (this.acr & 0x40) {
          // free-run: periodo latch + 2
          const period = this.t1Latch + 2;
          while (c < -1) c += period;
          if (this.acr & 0x80) { this.pb7 ^= 1; this.onPortBChange(this.portB()); }
        } else {
          this.t1Running = false;
          if (this.acr & 0x80) { this.pb7 = 1; this.onPortBChange(this.portB()); }
          c &= 0xFFFF;
        }
      } else {
        c &= 0xFFFF;
      }
    }
    this.t1Counter = c < 0 ? c + 0x10000 : c;

    // T2 (modo timer)
    if (!(this.acr & 0x20)) {
      let d = this.t2Counter - n;
      if (d < 0) {
        if (this.t2Running) {
          this.setIfr(IFR_T2);
          this.t2Running = false;
        }
        d &= 0xFFFF;
      }
      this.t2Counter = d;
    }
  }

  private setIfr(bits: number): void {
    this.ifr |= bits;
    this.updateIrq();
  }

  private clearIfr(bits: number): void {
    if (!(this.ifr & bits)) return;
    this.ifr &= ~bits;
    this.updateIrq();
  }

  private updateIrq(): void {
    const on = (this.ifr & this.ier & 0x7F) !== 0;
    if (on !== this.irqLine) {
      this.irqLine = on;
      this.onIrq(on);
    }
  }
}
