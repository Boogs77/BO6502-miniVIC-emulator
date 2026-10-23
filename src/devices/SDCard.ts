// SD card in SPI mode (standard capacity, byte addressing)
//
// Connected to the pins of a VIA and bit-banged by software (like the BO6502 BIOS):
//   CS (active low), SCK, MOSI into the card; MISO out of it.
// The MISO bit changes on every rising edge of SCK and is valid during the high level:
// that is how the driver reads it (SCK high, then LDA of the port).
// Commands: CMD0, CMD8 (answers "illegal": v1 card), CMD12, CMD16,
// CMD17 (block read), CMD24 (block write), CMD55 + ACMD41, CMD58.

const BLOCK = 512;

export class SDCard {
  /** card image (null = no card inserted) */
  image: Uint8Array | null = null;
  /** called after a write to the card */
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
  // block write (CMD24)
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

  /** MISO level (1 if CS is high or there is no card) */
  get miso(): number {
    return this.cs || !this.image ? 1 : this.misoBit;
  }

  /** updates the pins driven by the host */
  setPins(cs: number, sck: number, mosi: number): void {
    cs = cs ? 1 : 0;
    sck = sck ? 1 : 0;
    if (cs !== this.cs) {
      this.cs = cs;
      if (!cs) this.bitCount = 0;   // start of a transaction: realign the bytes
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
      if ((b & 0xC0) !== 0x40) return; // waiting for the start bit of a command
    }
    this.cmd.push(b);
    if (this.cmd.length === 6) {
      const c = this.cmd;
      this.cmd = [];
      this.command(c[0] & 0x3F, ((c[1] << 24) | (c[2] << 16) | (c[3] << 8) | c[4]) >>> 0);
    }
  }

  private respond(...bytes: number[]): void {
    this.outQueue = [0xFF, ...bytes];   // one wait byte (NCR) before the response
  }

  private r1(): number {
    return this.idle ? 0x01 : 0x00;
  }

  private command(cmd: number, arg: number): void {
    const app = this.appCmd;
    this.appCmd = false;
    const img = this.image!;
    if (app && cmd === 41) {
      // ACMD41: the card leaves the idle state after a few attempts
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
        this.respond(0x05);             // illegal command: SD v1 card (SDSC)
        break;
      case 55:
        this.appCmd = true;
        this.respond(this.r1());
        break;
      case 58:
        this.respond(this.r1(), 0x80, 0xFF, 0x80, 0x00); // OCR: powered up, 2.7-3.6V, not SDHC
        break;
      case 16:
        this.respond(arg === BLOCK ? this.r1() : 0x40);
        break;
      case 12:
        this.respond(0x00);
        break;
      case 17: {
        if (this.idle) { this.respond(0x01); break; }
        if (arg + BLOCK > img.length) { this.respond(0x40); break; } // parameter error
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
        this.respond(this.r1() | 0x04); // unsupported command
    }
  }

  private writeData(b: number): void {
    if (this.writeBuf.length === 0 && b !== 0xFE) return; // waiting for the data token
    this.writeBuf.push(b);
    if (this.writeBuf.length === 1 + BLOCK + 2) {
      this.image!.set(this.writeBuf.slice(1, 1 + BLOCK), this.writeAddr);
      this.writing = false;
      this.outQueue = [0x05, 0x00, 0x00, 0xFF]; // data accepted, then busy for a few bytes
      this.onWrite();
    }
  }
}
