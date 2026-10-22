// Scheda SD in modo SPI (standard capacity, indirizzamento a byte)
//
// Collegata ai pin di una VIA e pilotata a bit dal software (come il BIOS BO6502):
//   CS (attivo basso), SCK, MOSI in ingresso alla scheda; MISO in uscita.
// Il bit su MISO cambia a ogni fronte di salita di SCK ed e' valido durante il livello
// alto: e' cosi' che lo legge il driver (SCK alto, poi LDA della porta).
// Comandi: CMD0, CMD8 (risponde "illegale": scheda v1), CMD9/10 minimi, CMD12, CMD16,
// CMD17 (lettura blocco), CMD24 (scrittura blocco), CMD55 + ACMD41, CMD58.

const BLOCK = 512;

export class SDCard {
  /** immagine della scheda (null = nessuna scheda inserita) */
  image: Uint8Array | null = null;
  /** chiamata dopo una scrittura sulla scheda */
  onWrite: () => void = () => {};

  private cs = 1;
  private sck = 0;
  private misoBit = 1;
  private bitCount = 0;
  private inByte = 0;
  private outByte = 0xFF;
  private outQueue: number[] = [];
  private cmd: number[] = [];
  private idle = true;
  private appCmd = false;
  private acmd41Tries = 0;
  // scrittura di un blocco (CMD24)
  private writeAddr = -1;
  private writeBuf: number[] = [];
  private writing = false;

  get inserted(): boolean {
    return this.image !== null;
  }

  insert(image: Uint8Array | null): void {
    this.image = image;
    this.idle = true;
    this.outQueue = [];
    this.cmd = [];
  }

  /** livello di MISO (1 se CS e' alto o non c'e' la scheda) */
  get miso(): number {
    return this.cs || !this.image ? 1 : this.misoBit;
  }

  /** aggiorna i pin pilotati dall'host */
  setPins(cs: number, sck: number, mosi: number): void {
    cs = cs ? 1 : 0;
    sck = sck ? 1 : 0;
    if (cs !== this.cs) {
      this.cs = cs;
      if (!cs) this.bitCount = 0;   // inizio di una transazione: riallinea i byte
    }
    if (sck !== this.sck) {
      this.sck = sck;
      if (sck && !this.cs && this.image) this.risingEdge(mosi ? 1 : 0);
    }
  }

  private risingEdge(mosi: number): void {
    if (this.bitCount === 0) this.outByte = this.outQueue.length ? this.outQueue.shift()! : 0xFF;
    this.misoBit = (this.outByte >> (7 - this.bitCount)) & 1;
    this.inByte = ((this.inByte << 1) | mosi) & 0xFF;
    if (++this.bitCount === 8) {
      this.bitCount = 0;
      this.byteIn(this.inByte);
    }
  }

  private byteIn(b: number): void {
    if (this.writing) {
      this.writeData(b);
      return;
    }
    if (this.cmd.length === 0) {
      if ((b & 0xC0) !== 0x40) return; // attesa del bit di start di un comando
    }
    this.cmd.push(b);
    if (this.cmd.length === 6) {
      const c = this.cmd;
      this.cmd = [];
      this.command(c[0] & 0x3F, ((c[1] << 24) | (c[2] << 16) | (c[3] << 8) | c[4]) >>> 0);
    }
  }

  private respond(...bytes: number[]): void {
    this.outQueue = [0xFF, ...bytes];   // un byte di attesa (NCR) prima della risposta
  }

  private r1(): number {
    return this.idle ? 0x01 : 0x00;
  }

  private command(cmd: number, arg: number): void {
    const app = this.appCmd;
    this.appCmd = false;
    const img = this.image!;
    if (app && cmd === 41) {
      // ACMD41: la scheda esce dallo stato idle dopo qualche tentativo
      if (++this.acmd41Tries >= 2) this.idle = false;
      this.respond(this.r1());
      return;
    }
    switch (cmd) {
      case 0:
        this.idle = true;
        this.acmd41Tries = 0;
        this.respond(0x01);
        break;
      case 8:
        this.respond(0x05);             // comando illegale: scheda SD v1 (SDSC)
        break;
      case 55:
        this.appCmd = true;
        this.respond(this.r1());
        break;
      case 58:
        this.respond(this.r1(), 0x80, 0xFF, 0x80, 0x00); // OCR: alimentata, 2.7-3.6V, non SDHC
        break;
      case 16:
        this.respond(arg === BLOCK ? this.r1() : 0x40);
        break;
      case 12:
        this.respond(0x00);
        break;
      case 17: {
        if (this.idle) { this.respond(0x01); break; }
        if (arg + BLOCK > img.length) { this.respond(0x40); break; } // errore di parametro
        const data = Array.from(img.subarray(arg, arg + BLOCK));
        this.outQueue = [0xFF, 0x00, 0xFF, 0xFF, 0xFE, ...data, 0xFF, 0xFF];
        break;
      }
      case 24:
        if (this.idle) { this.respond(0x01); break; }
        if (arg + BLOCK > img.length) { this.respond(0x40); break; }
        this.writeAddr = arg;
        this.writeBuf = [];
        this.writing = true;
        this.respond(0x00);
        break;
      default:
        this.respond(this.r1() | 0x04); // comando non supportato
    }
  }

  private writeData(b: number): void {
    if (this.writeBuf.length === 0 && b !== 0xFE) return; // attesa del data token
    this.writeBuf.push(b);
    if (this.writeBuf.length === 1 + BLOCK + 2) {
      this.image!.set(this.writeBuf.slice(1, 1 + BLOCK), this.writeAddr);
      this.writing = false;
      this.outQueue = [0x05, 0x00, 0x00, 0xFF]; // dati accettati, poi occupato per qualche byte
      this.onWrite();
    }
  }
}
