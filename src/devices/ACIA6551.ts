// W65C51 ACIA - porta seriale
//
//   $0 dati (lettura: byte ricevuto, scrittura: byte da trasmettere)
//   $1 stato (bit 3 RDRF, bit 4 TDRE, bit 7 IRQ) / scrittura = reset software
//   $2 comando, $3 controllo
// La trasmissione e' istantanea (TDRE sempre a 1, come il W65C51 reale che non
// segnala la fine della trasmissione): il BIOS usa un ciclo di attesa.
// La ricezione ha una coda: un byte alla volta in RDR, il successivo dopo la lettura.

export class ACIA6551 {
  command = 0;
  control = 0;
  /** byte trasmesso dalla CPU */
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

  /** byte in arrivo dal terminale */
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
      case 1: this.command &= 0xE0; this.overrun = false; this.updateIrq(); break; // reset software
      case 2: this.command = v; this.updateIrq(); break;
      default: this.control = v; break;
    }
  }

  private updateIrq(): void {
    // IRQ in ricezione se DTR attivo (bit 0) e interrupt RX abilitato (bit 1 = 0)
    const on = (this.command & 0x01) !== 0 && (this.command & 0x02) === 0 && this.rdrFull;
    if (on !== this.irqLine) {
      this.irqLine = on;
      this.onIrq(on);
    }
  }
}
