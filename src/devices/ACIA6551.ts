// W65C51 ACIA - serial port
//
//   $0 data (read: received byte, write: byte to transmit)
//   $1 status (bit 3 RDRF, bit 4 TDRE, bit 7 IRQ) / write = software reset
//   $2 command, $3 control
// Transmission is instantaneous (TDRE always 1, like the real W65C51, which does not
// signal the end of transmission): the BIOS uses a delay loop.
// Reception has a queue: one byte at a time in RDR, the next one after it is read.

export class ACIA6551 {
  command = 0;
  control = 0;
  /** byte transmitted by the CPU */
  onTransmit: (byte: number) => void = () => {};
  onIrq: (active: boolean) => void = () => {};

  private rxQueue: number[] = [];
  private rdr = 0;
  private rdrFull = false;
  private overrun = false;
  private irqLine = false;

  reset(): void {
    this.command = 0;
    this.control = 0;
    this.rxQueue = [];
    this.rdrFull = false;
    this.overrun = false;
    this.updateIrq();
  }

  /** byte arriving from the terminal */
  receive(byte: number): void {
    this.rxQueue.push(byte & 0xFF);
    this.fillRdr();
  }

  get pending(): number {
    return this.rxQueue.length + (this.rdrFull ? 1 : 0);
  }

  private fillRdr(): void {
    if (!this.rdrFull && this.rxQueue.length) {
      this.rdr = this.rxQueue.shift()!;
      this.rdrFull = true;
      this.updateIrq();
    }
  }

  private get statusValue(): number {
    let s = 0x10;                          // TDRE
    if (this.rdrFull) s |= 0x08;
    if (this.overrun) s |= 0x04;
    if (this.irqLine) s |= 0x80;
    return s;
  }

  read(reg: number): number {
    switch (reg & 3) {
      case 0: {
        const v = this.rdr;
        this.rdrFull = false;
        this.overrun = false;
        this.updateIrq();
        this.fillRdr();
        return v;
      }
      case 1: return this.statusValue;
      case 2: return this.command;
      default: return this.control;
    }
  }

  peek(reg: number): number {
    switch (reg & 3) {
      case 0: return this.rdr;
      case 1: return this.statusValue;
      case 2: return this.command;
      default: return this.control;
    }
  }

  write(reg: number, v: number): void {
    switch (reg & 3) {
      case 0: this.onTransmit(v); break;
      case 1: this.command &= 0xE0; this.overrun = false; this.updateIrq(); break; // software reset
      case 2: this.command = v; this.updateIrq(); break;
      default: this.control = v; break;
    }
  }

  private updateIrq(): void {
    // receive IRQ if DTR is active (bit 0) and the RX interrupt is enabled (bit 1 = 0)
    const on = (this.command & 0x01) !== 0 && (this.command & 0x02) === 0 && this.rdrFull;
    if (on !== this.irqLine) {
      this.irqLine = on;
      this.onIrq(on);
    }
  }
}
