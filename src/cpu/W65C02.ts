// W65C02S - core della CPU
//
// Set completo WDC 65C02: istruzioni CMOS (BRA, PHX/PLX, STZ, TSB/TRB, (zp), ...),
// istruzioni Rockwell sui bit (RMB/SMB/BBR/BBS), WAI e STP, NOP non documentati
// con le loro lunghezze e i loro cicli. Cicli esatti per istruzione, comprese le
// penalita' di attraversamento pagina e il ciclo in piu' della modalita' decimale.
// IRQ sensibile al livello, NMI sul fronte (gestito dalla macchina con nmi()).

export interface CpuBus {
  read(addr: number): number;
  write(addr: number, value: number): void;
}

export const FLAG_C = 0x01;
export const FLAG_Z = 0x02;
export const FLAG_I = 0x04;
export const FLAG_D = 0x08;
export const FLAG_B = 0x10;
export const FLAG_U = 0x20;
export const FLAG_V = 0x40;
export const FLAG_N = 0x80;

export class W65C02 {
  a = 0;
  x = 0;
  y = 0;
  sp = 0xFD;
  pc = 0;
  p = FLAG_U | FLAG_I;

  /** cicli totali eseguiti dall'accensione */
  cycles = 0;
  /** linea IRQ (livello): la imposta la macchina */
  irq = false;
  /** WAI in corso: la CPU aspetta un interrupt */
  waiting = false;
  /** STP eseguito: ferma fino al reset */
  stopped = false;

  private nmiPending = false;
  private bus: CpuBus;

  constructor(bus: CpuBus) {
    this.bus = bus;
  }

  reset(): void {
    this.sp = (this.sp - 3) & 0xFF;
    this.p = (this.p | FLAG_I | FLAG_U) & ~FLAG_D;
    this.waiting = false;
    this.stopped = false;
    this.nmiPending = false;
    this.pc = this.read16(0xFFFC);
    this.cycles += 7;
  }

  /** fronte di discesa della linea NMI */
  nmi(): void {
    this.nmiPending = true;
  }

  // ---------------- accesso al bus ----------------
  private rd(a: number): number {
    return this.bus.read(a & 0xFFFF);
  }
  private wr(a: number, v: number): void {
    this.bus.write(a & 0xFFFF, v & 0xFF);
  }
  read16(a: number): number {
    return this.rd(a) | (this.rd(a + 1) << 8);
  }
  private fetch(): number {
    const v = this.rd(this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;
    return v;
  }
  private fetch16(): number {
    const v = this.read16(this.pc);
    this.pc = (this.pc + 2) & 0xFFFF;
    return v;
  }
  private push(v: number): void {
    this.wr(0x100 | this.sp, v);
    this.sp = (this.sp - 1) & 0xFF;
  }
  private pull(): number {
    this.sp = (this.sp + 1) & 0xFF;
    return this.rd(0x100 | this.sp);
  }

  // ---------------- flag ----------------
  private nz(v: number): number {
    this.p = (this.p & ~(FLAG_N | FLAG_Z)) | (v & FLAG_N) | (v === 0 ? FLAG_Z : 0);
    return v;
  }
  private setFlag(f: number, on: boolean | number): void {
    if (on) this.p |= f;
    else this.p &= ~f;
  }

  // ---------------- modi di indirizzamento ----------------
  // "extra" accumula il ciclo di penalita' per l'attraversamento di pagina
  private extra = 0;

  private zp(): number { return this.fetch(); }
  private zpx(): number { return (this.fetch() + this.x) & 0xFF; }
  private zpy(): number { return (this.fetch() + this.y) & 0xFF; }
  private abs(): number { return this.fetch16(); }
  private abxR(): number {
    const b = this.fetch16();
    const a = (b + this.x) & 0xFFFF;
    if ((a ^ b) & 0xFF00) this.extra = 1;
    return a;
  }
  private abyR(): number {
    const b = this.fetch16();
    const a = (b + this.y) & 0xFFFF;
    if ((a ^ b) & 0xFF00) this.extra = 1;
    return a;
  }
  private abxW(): number { return (this.fetch16() + this.x) & 0xFFFF; }
  private abyW(): number { return (this.fetch16() + this.y) & 0xFFFF; }
  private zpPtr(z: number): number {
    return this.rd(z & 0xFF) | (this.rd((z + 1) & 0xFF) << 8);
  }
  private izx(): number { return this.zpPtr(this.fetch() + this.x); }
  private izyR(): number {
    const b = this.zpPtr(this.fetch());
    const a = (b + this.y) & 0xFFFF;
    if ((a ^ b) & 0xFF00) this.extra = 1;
    return a;
  }
  private izyW(): number { return (this.zpPtr(this.fetch()) + this.y) & 0xFFFF; }
  private izp(): number { return this.zpPtr(this.fetch()); }

  // ---------------- ALU ----------------
  private adc(v: number): void {
    const c = this.p & FLAG_C;
    if (this.p & FLAG_D) {
      let lo = (this.a & 0x0F) + (v & 0x0F) + c;
      if (lo >= 0x0A) lo = ((lo + 0x06) & 0x0F) + 0x10;
      let r = (this.a & 0xF0) + (v & 0xF0) + lo;
      this.setFlag(FLAG_V, (this.a ^ r) & (v ^ r) & 0x80);
      if (r >= 0xA0) r += 0x60;
      this.setFlag(FLAG_C, r >= 0x100);
      this.a = this.nz(r & 0xFF);
      this.extra++;
    } else {
      const r = this.a + v + c;
      this.setFlag(FLAG_V, (this.a ^ r) & (v ^ r) & 0x80);
      this.setFlag(FLAG_C, r > 0xFF);
      this.a = this.nz(r & 0xFF);
    }
  }
  private sbc(v: number): void {
    const b = (this.p & FLAG_C) ? 0 : 1;
    let r = this.a - v - b;
    this.setFlag(FLAG_V, (this.a ^ v) & (this.a ^ r) & 0x80);
    this.setFlag(FLAG_C, r >= 0);
    if (this.p & FLAG_D) {
      const lo = (this.a & 0x0F) - (v & 0x0F) - b;
      if (r < 0) r -= 0x60;
      if (lo < 0) r -= 0x06;
      this.extra++;
    }
    this.a = this.nz(r & 0xFF);
  }
  private cmp(reg: number, v: number): void {
    const t = reg - v;
    this.setFlag(FLAG_C, t >= 0);
    this.nz(t & 0xFF);
  }
  private bit(v: number): void {
    this.setFlag(FLAG_Z, (this.a & v) === 0);
    this.p = (this.p & ~(FLAG_N | FLAG_V)) | (v & (FLAG_N | FLAG_V));
  }
  private asl(v: number): number { this.setFlag(FLAG_C, v & 0x80); return this.nz((v << 1) & 0xFF); }
  private lsr(v: number): number { this.setFlag(FLAG_C, v & 1); return this.nz(v >> 1); }
  private rol(v: number): number {
    const r = ((v << 1) | (this.p & FLAG_C)) & 0xFF;
    this.setFlag(FLAG_C, v & 0x80);
    return this.nz(r);
  }
  private ror(v: number): number {
    const r = (v >> 1) | ((this.p & FLAG_C) << 7);
    this.setFlag(FLAG_C, v & 1);
    return this.nz(r);
  }

  private rmw(addr: number, f: (v: number) => number): void {
    this.wr(addr, f.call(this, this.rd(addr)));
  }

  /** salto relativo: +1 ciclo se preso, +1 se cambia pagina */
  private branch(cond: boolean | number): number {
    const off = this.fetch();
    if (!cond) return 0;
    const target = (this.pc + (off < 0x80 ? off : off - 0x100)) & 0xFFFF;
    const c = ((target ^ this.pc) & 0xFF00) ? 2 : 1;
    this.pc = target;
    return c;
  }

  private interrupt(vector: number, brk: boolean): void {
    this.push(this.pc >> 8);
    this.push(this.pc & 0xFF);
    this.push(brk ? (this.p | FLAG_B | FLAG_U) : ((this.p & ~FLAG_B) | FLAG_U));
    this.p = (this.p | FLAG_I) & ~FLAG_D;
    this.pc = this.read16(vector);
  }

  /** esegue un'istruzione (o un interrupt) e ritorna i cicli impiegati */
  step(): number {
    if (this.stopped) {
      this.cycles += 1;
      return 1;
    }
    if (this.nmiPending) {
      this.nmiPending = false;
      this.waiting = false;
      this.interrupt(0xFFFA, false);
      this.cycles += 7;
      return 7;
    }
    if (this.irq) {
      if (!(this.p & FLAG_I)) {
        this.waiting = false;
        this.interrupt(0xFFFE, false);
        this.cycles += 7;
        return 7;
      }
      this.waiting = false; // WAI riprende anche con I=1, senza servire l'IRQ
    }
    if (this.waiting) {
      this.cycles += 1;
      return 1;
    }

    this.extra = 0;
    const op = this.fetch();
    let c: number;

    switch (op) {
      // ---------- LDA ----------
      case 0xA9: this.a = this.nz(this.fetch()); c = 2; break;
      case 0xA5: this.a = this.nz(this.rd(this.zp())); c = 3; break;
      case 0xB5: this.a = this.nz(this.rd(this.zpx())); c = 4; break;
      case 0xAD: this.a = this.nz(this.rd(this.abs())); c = 4; break;
      case 0xBD: this.a = this.nz(this.rd(this.abxR())); c = 4; break;
      case 0xB9: this.a = this.nz(this.rd(this.abyR())); c = 4; break;
      case 0xA1: this.a = this.nz(this.rd(this.izx())); c = 6; break;
      case 0xB1: this.a = this.nz(this.rd(this.izyR())); c = 5; break;
      case 0xB2: this.a = this.nz(this.rd(this.izp())); c = 5; break;
      // ---------- LDX ----------
      case 0xA2: this.x = this.nz(this.fetch()); c = 2; break;
      case 0xA6: this.x = this.nz(this.rd(this.zp())); c = 3; break;
      case 0xB6: this.x = this.nz(this.rd(this.zpy())); c = 4; break;
      case 0xAE: this.x = this.nz(this.rd(this.abs())); c = 4; break;
      case 0xBE: this.x = this.nz(this.rd(this.abyR())); c = 4; break;
      // ---------- LDY ----------
      case 0xA0: this.y = this.nz(this.fetch()); c = 2; break;
      case 0xA4: this.y = this.nz(this.rd(this.zp())); c = 3; break;
      case 0xB4: this.y = this.nz(this.rd(this.zpx())); c = 4; break;
      case 0xAC: this.y = this.nz(this.rd(this.abs())); c = 4; break;
      case 0xBC: this.y = this.nz(this.rd(this.abxR())); c = 4; break;
      // ---------- STA ----------
      case 0x85: this.wr(this.zp(), this.a); c = 3; break;
      case 0x95: this.wr(this.zpx(), this.a); c = 4; break;
      case 0x8D: this.wr(this.abs(), this.a); c = 4; break;
      case 0x9D: this.wr(this.abxW(), this.a); c = 5; break;
      case 0x99: this.wr(this.abyW(), this.a); c = 5; break;
      case 0x81: this.wr(this.izx(), this.a); c = 6; break;
      case 0x91: this.wr(this.izyW(), this.a); c = 6; break;
      case 0x92: this.wr(this.izp(), this.a); c = 5; break;
      // ---------- STX / STY / STZ ----------
      case 0x86: this.wr(this.zp(), this.x); c = 3; break;
      case 0x96: this.wr(this.zpy(), this.x); c = 4; break;
      case 0x8E: this.wr(this.abs(), this.x); c = 4; break;
      case 0x84: this.wr(this.zp(), this.y); c = 3; break;
      case 0x94: this.wr(this.zpx(), this.y); c = 4; break;
      case 0x8C: this.wr(this.abs(), this.y); c = 4; break;
      case 0x64: this.wr(this.zp(), 0); c = 3; break;
      case 0x74: this.wr(this.zpx(), 0); c = 4; break;
      case 0x9C: this.wr(this.abs(), 0); c = 4; break;
      case 0x9E: this.wr(this.abxW(), 0); c = 5; break;
      // ---------- trasferimenti ----------
      case 0xAA: this.x = this.nz(this.a); c = 2; break;
      case 0xA8: this.y = this.nz(this.a); c = 2; break;
      case 0x8A: this.a = this.nz(this.x); c = 2; break;
      case 0x98: this.a = this.nz(this.y); c = 2; break;
      case 0xBA: this.x = this.nz(this.sp); c = 2; break;
      case 0x9A: this.sp = this.x; c = 2; break;
      // ---------- stack ----------
      case 0x48: this.push(this.a); c = 3; break;
      case 0xDA: this.push(this.x); c = 3; break;
      case 0x5A: this.push(this.y); c = 3; break;
      case 0x08: this.push(this.p | FLAG_B | FLAG_U); c = 3; break;
      case 0x68: this.a = this.nz(this.pull()); c = 4; break;
      case 0xFA: this.x = this.nz(this.pull()); c = 4; break;
      case 0x7A: this.y = this.nz(this.pull()); c = 4; break;
      case 0x28: this.p = this.pull() | FLAG_U | FLAG_B; c = 4; break;
      // ---------- ADC ----------
      case 0x69: this.adc(this.fetch()); c = 2; break;
      case 0x65: this.adc(this.rd(this.zp())); c = 3; break;
      case 0x75: this.adc(this.rd(this.zpx())); c = 4; break;
      case 0x6D: this.adc(this.rd(this.abs())); c = 4; break;
      case 0x7D: this.adc(this.rd(this.abxR())); c = 4; break;
      case 0x79: this.adc(this.rd(this.abyR())); c = 4; break;
      case 0x61: this.adc(this.rd(this.izx())); c = 6; break;
      case 0x71: this.adc(this.rd(this.izyR())); c = 5; break;
      case 0x72: this.adc(this.rd(this.izp())); c = 5; break;
      // ---------- SBC ----------
      case 0xE9: this.sbc(this.fetch()); c = 2; break;
      case 0xE5: this.sbc(this.rd(this.zp())); c = 3; break;
      case 0xF5: this.sbc(this.rd(this.zpx())); c = 4; break;
      case 0xED: this.sbc(this.rd(this.abs())); c = 4; break;
      case 0xFD: this.sbc(this.rd(this.abxR())); c = 4; break;
      case 0xF9: this.sbc(this.rd(this.abyR())); c = 4; break;
      case 0xE1: this.sbc(this.rd(this.izx())); c = 6; break;
      case 0xF1: this.sbc(this.rd(this.izyR())); c = 5; break;
      case 0xF2: this.sbc(this.rd(this.izp())); c = 5; break;
      // ---------- AND ----------
      case 0x29: this.a = this.nz(this.a & this.fetch()); c = 2; break;
      case 0x25: this.a = this.nz(this.a & this.rd(this.zp())); c = 3; break;
      case 0x35: this.a = this.nz(this.a & this.rd(this.zpx())); c = 4; break;
      case 0x2D: this.a = this.nz(this.a & this.rd(this.abs())); c = 4; break;
      case 0x3D: this.a = this.nz(this.a & this.rd(this.abxR())); c = 4; break;
      case 0x39: this.a = this.nz(this.a & this.rd(this.abyR())); c = 4; break;
      case 0x21: this.a = this.nz(this.a & this.rd(this.izx())); c = 6; break;
      case 0x31: this.a = this.nz(this.a & this.rd(this.izyR())); c = 5; break;
      case 0x32: this.a = this.nz(this.a & this.rd(this.izp())); c = 5; break;
      // ---------- ORA ----------
      case 0x09: this.a = this.nz(this.a | this.fetch()); c = 2; break;
      case 0x05: this.a = this.nz(this.a | this.rd(this.zp())); c = 3; break;
      case 0x15: this.a = this.nz(this.a | this.rd(this.zpx())); c = 4; break;
      case 0x0D: this.a = this.nz(this.a | this.rd(this.abs())); c = 4; break;
      case 0x1D: this.a = this.nz(this.a | this.rd(this.abxR())); c = 4; break;
      case 0x19: this.a = this.nz(this.a | this.rd(this.abyR())); c = 4; break;
      case 0x01: this.a = this.nz(this.a | this.rd(this.izx())); c = 6; break;
      case 0x11: this.a = this.nz(this.a | this.rd(this.izyR())); c = 5; break;
      case 0x12: this.a = this.nz(this.a | this.rd(this.izp())); c = 5; break;
      // ---------- EOR ----------
      case 0x49: this.a = this.nz(this.a ^ this.fetch()); c = 2; break;
      case 0x45: this.a = this.nz(this.a ^ this.rd(this.zp())); c = 3; break;
      case 0x55: this.a = this.nz(this.a ^ this.rd(this.zpx())); c = 4; break;
      case 0x4D: this.a = this.nz(this.a ^ this.rd(this.abs())); c = 4; break;
      case 0x5D: this.a = this.nz(this.a ^ this.rd(this.abxR())); c = 4; break;
      case 0x59: this.a = this.nz(this.a ^ this.rd(this.abyR())); c = 4; break;
      case 0x41: this.a = this.nz(this.a ^ this.rd(this.izx())); c = 6; break;
      case 0x51: this.a = this.nz(this.a ^ this.rd(this.izyR())); c = 5; break;
      case 0x52: this.a = this.nz(this.a ^ this.rd(this.izp())); c = 5; break;
      // ---------- CMP / CPX / CPY ----------
      case 0xC9: this.cmp(this.a, this.fetch()); c = 2; break;
      case 0xC5: this.cmp(this.a, this.rd(this.zp())); c = 3; break;
      case 0xD5: this.cmp(this.a, this.rd(this.zpx())); c = 4; break;
      case 0xCD: this.cmp(this.a, this.rd(this.abs())); c = 4; break;
      case 0xDD: this.cmp(this.a, this.rd(this.abxR())); c = 4; break;
      case 0xD9: this.cmp(this.a, this.rd(this.abyR())); c = 4; break;
      case 0xC1: this.cmp(this.a, this.rd(this.izx())); c = 6; break;
      case 0xD1: this.cmp(this.a, this.rd(this.izyR())); c = 5; break;
      case 0xD2: this.cmp(this.a, this.rd(this.izp())); c = 5; break;
      case 0xE0: this.cmp(this.x, this.fetch()); c = 2; break;
      case 0xE4: this.cmp(this.x, this.rd(this.zp())); c = 3; break;
      case 0xEC: this.cmp(this.x, this.rd(this.abs())); c = 4; break;
      case 0xC0: this.cmp(this.y, this.fetch()); c = 2; break;
      case 0xC4: this.cmp(this.y, this.rd(this.zp())); c = 3; break;
      case 0xCC: this.cmp(this.y, this.rd(this.abs())); c = 4; break;
      // ---------- BIT ----------
      case 0x89: this.setFlag(FLAG_Z, (this.a & this.fetch()) === 0); c = 2; break;
      case 0x24: this.bit(this.rd(this.zp())); c = 3; break;
      case 0x34: this.bit(this.rd(this.zpx())); c = 4; break;
      case 0x2C: this.bit(this.rd(this.abs())); c = 4; break;
      case 0x3C: this.bit(this.rd(this.abxR())); c = 4; break;
      // ---------- TSB / TRB ----------
      case 0x04: { const a = this.zp(); const v = this.rd(a); this.setFlag(FLAG_Z, (v & this.a) === 0); this.wr(a, v | this.a); c = 5; break; }
      case 0x0C: { const a = this.abs(); const v = this.rd(a); this.setFlag(FLAG_Z, (v & this.a) === 0); this.wr(a, v | this.a); c = 6; break; }
      case 0x14: { const a = this.zp(); const v = this.rd(a); this.setFlag(FLAG_Z, (v & this.a) === 0); this.wr(a, v & ~this.a); c = 5; break; }
      case 0x1C: { const a = this.abs(); const v = this.rd(a); this.setFlag(FLAG_Z, (v & this.a) === 0); this.wr(a, v & ~this.a); c = 6; break; }
      // ---------- INC / DEC ----------
      case 0x1A: this.a = this.nz((this.a + 1) & 0xFF); c = 2; break;
      case 0x3A: this.a = this.nz((this.a - 1) & 0xFF); c = 2; break;
      case 0xE6: this.rmw(this.zp(), v => this.nz((v + 1) & 0xFF)); c = 5; break;
      case 0xF6: this.rmw(this.zpx(), v => this.nz((v + 1) & 0xFF)); c = 6; break;
      case 0xEE: this.rmw(this.abs(), v => this.nz((v + 1) & 0xFF)); c = 6; break;
      case 0xFE: this.rmw(this.abxW(), v => this.nz((v + 1) & 0xFF)); c = 7; break;
      case 0xC6: this.rmw(this.zp(), v => this.nz((v - 1) & 0xFF)); c = 5; break;
      case 0xD6: this.rmw(this.zpx(), v => this.nz((v - 1) & 0xFF)); c = 6; break;
      case 0xCE: this.rmw(this.abs(), v => this.nz((v - 1) & 0xFF)); c = 6; break;
      case 0xDE: this.rmw(this.abxW(), v => this.nz((v - 1) & 0xFF)); c = 7; break;
      case 0xE8: this.x = this.nz((this.x + 1) & 0xFF); c = 2; break;
      case 0xC8: this.y = this.nz((this.y + 1) & 0xFF); c = 2; break;
      case 0xCA: this.x = this.nz((this.x - 1) & 0xFF); c = 2; break;
      case 0x88: this.y = this.nz((this.y - 1) & 0xFF); c = 2; break;
      // ---------- scorrimenti ----------
      case 0x0A: this.a = this.asl(this.a); c = 2; break;
      case 0x06: this.rmw(this.zp(), this.asl); c = 5; break;
      case 0x16: this.rmw(this.zpx(), this.asl); c = 6; break;
      case 0x0E: this.rmw(this.abs(), this.asl); c = 6; break;
      case 0x1E: this.rmw(this.abxR(), this.asl); c = 6; break;
      case 0x4A: this.a = this.lsr(this.a); c = 2; break;
      case 0x46: this.rmw(this.zp(), this.lsr); c = 5; break;
      case 0x56: this.rmw(this.zpx(), this.lsr); c = 6; break;
      case 0x4E: this.rmw(this.abs(), this.lsr); c = 6; break;
      case 0x5E: this.rmw(this.abxR(), this.lsr); c = 6; break;
      case 0x2A: this.a = this.rol(this.a); c = 2; break;
      case 0x26: this.rmw(this.zp(), this.rol); c = 5; break;
      case 0x36: this.rmw(this.zpx(), this.rol); c = 6; break;
      case 0x2E: this.rmw(this.abs(), this.rol); c = 6; break;
      case 0x3E: this.rmw(this.abxR(), this.rol); c = 6; break;
      case 0x6A: this.a = this.ror(this.a); c = 2; break;
      case 0x66: this.rmw(this.zp(), this.ror); c = 5; break;
      case 0x76: this.rmw(this.zpx(), this.ror); c = 6; break;
      case 0x6E: this.rmw(this.abs(), this.ror); c = 6; break;
      case 0x7E: this.rmw(this.abxR(), this.ror); c = 6; break;
      // ---------- salti ----------
      case 0x4C: this.pc = this.fetch16(); c = 3; break;
      case 0x6C: this.pc = this.read16(this.fetch16()); c = 6; break;
      case 0x7C: this.pc = this.read16((this.fetch16() + this.x) & 0xFFFF); c = 6; break;
      case 0x20: {
        const t = this.fetch16();
        const ret = (this.pc - 1) & 0xFFFF;
        this.push(ret >> 8);
        this.push(ret & 0xFF);
        this.pc = t;
        c = 6;
        break;
      }
      case 0x60: this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xFFFF; c = 6; break;
      case 0x40: this.p = this.pull() | FLAG_U | FLAG_B; this.pc = this.pull() | (this.pull() << 8); c = 6; break;
      case 0x00: this.pc = (this.pc + 1) & 0xFFFF; this.interrupt(0xFFFE, true); c = 7; break;
      // ---------- branch ----------
      case 0x10: c = 2 + this.branch(!(this.p & FLAG_N)); break;
      case 0x30: c = 2 + this.branch(this.p & FLAG_N); break;
      case 0x50: c = 2 + this.branch(!(this.p & FLAG_V)); break;
      case 0x70: c = 2 + this.branch(this.p & FLAG_V); break;
      case 0x90: c = 2 + this.branch(!(this.p & FLAG_C)); break;
      case 0xB0: c = 2 + this.branch(this.p & FLAG_C); break;
      case 0xD0: c = 2 + this.branch(!(this.p & FLAG_Z)); break;
      case 0xF0: c = 2 + this.branch(this.p & FLAG_Z); break;
      case 0x80: c = 2 + this.branch(true); break;
      // ---------- flag ----------
      case 0x18: this.p &= ~FLAG_C; c = 2; break;
      case 0x38: this.p |= FLAG_C; c = 2; break;
      case 0x58: this.p &= ~FLAG_I; c = 2; break;
      case 0x78: this.p |= FLAG_I; c = 2; break;
      case 0xB8: this.p &= ~FLAG_V; c = 2; break;
      case 0xD8: this.p &= ~FLAG_D; c = 2; break;
      case 0xF8: this.p |= FLAG_D; c = 2; break;
      // ---------- vari ----------
      case 0xEA: c = 2; break;
      case 0xCB: this.waiting = true; c = 3; break;
      case 0xDB: this.stopped = true; c = 3; break;
      // ---------- NOP non documentati ----------
      case 0x02: case 0x22: case 0x42: case 0x62: case 0x82: case 0xC2: case 0xE2:
        this.fetch(); c = 2; break;
      case 0x44: this.fetch(); c = 3; break;
      case 0x54: case 0xD4: case 0xF4: this.fetch(); c = 4; break;
      case 0x5C: this.fetch16(); c = 8; break;
      case 0xDC: case 0xFC: this.fetch16(); c = 4; break;
      default:
        c = this.bitOps(op);
    }

    c += this.extra;
    this.cycles += c;
    return c;
  }

  /** RMB / SMB / BBR / BBS e NOP da 1 ciclo (colonne 3 e B) */
  private bitOps(op: number): number {
    const lo = op & 0x0F;
    const n = (op >> 4) & 7;
    if (lo === 0x07) {
      const a = this.zp();
      const v = this.rd(a);
      this.wr(a, op & 0x80 ? v | (1 << n) : v & ~(1 << n));
      return 5;
    }
    if (lo === 0x0F) {
      const v = this.rd(this.zp());
      const set = (v & (1 << n)) !== 0;
      return 5 + this.branch(op & 0x80 ? set : !set);
    }
    return 1; // xx3 / xxB: NOP da un byte, un ciclo
  }
}
