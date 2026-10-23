// Toshiba T6963C (RA6963) - controller LCD grafico, display DS-G160128STBWW 160x128
//
//   interfaccia 8080: /CE, /WR, /RD, C/D; il byte si legge sul fronte di salita di /WR
//   C/D = 1 comando (scrittura) / stato (lettura); C/D = 0 dati
//   i dati prima di un comando sono i suoi parametri (max 2: D1, D2)
//   comandi: $21 cursore, $22 offset CG RAM, $24 puntatore indirizzi, $40-$43 home/area di
//            testo e grafica, $80-$8F modo (OR/EXOR/AND, CG ROM/RAM), $90-$9F display,
//            $A0-$A7 forma del cursore, $B0/$B1/$B2 auto write/read/fine, $C0-$C5 lettura e
//            scrittura con incremento/decremento, $F0-$FF bit reset/set
//   carattere: font 8x8 (FS = 0, 20 colonne su 160 pixel); codici $00-$7F = CG ROM (ASCII - $20),
//              $80-$FF (o tutti, con la CG RAM esterna) = CG RAM a offset * $800 + codice * 8
// Stato: STA0/STA1 sempre pronti (nessuna attesa), STA2/STA3 nei modi automatici.

import { glyph } from './font5x8';

export const T6963_W = 160;
export const T6963_H = 128;

export class T6963 {
  readonly ram = new Uint8Array(0x10000);
  textHome = 0;
  textArea = 20;
  graphicHome = 0;
  graphicArea = 20;
  /** modo: 0 OR, 1 EXOR, 3 AND, 4 attributi testo; bit 3 = solo CG RAM */
  mode = 0;
  /** bit0 lampeggio, bit1 cursore, bit2 testo, bit3 grafica */
  display = 0;
  cursorX = 0;
  cursorY = 0;
  cursorLines = 1;
  offset = 0;
  adp = 0;

  private params: number[] = [];
  private autoWrite = false;
  private autoRead = false;
  private readLatch = 0;

  reset(): void {
    this.params = [];
    this.autoWrite = this.autoRead = false;
    this.display = 0;
    this.mode = 0;
    this.adp = 0;
  }

  get status(): number {
    return 0x23 | (this.autoRead ? 0x04 : 0) | (this.autoWrite ? 0x08 : 0);
  }

  writeData(v: number): void {
    if (this.autoWrite) {
      this.ram[this.adp] = v;
      this.adp = (this.adp + 1) & 0xFFFF;
      return;
    }
    this.params.push(v);
    if (this.params.length > 2) this.params.shift();
  }

  readData(): number {
    if (this.autoRead) {
      const v = this.ram[this.adp];
      this.adp = (this.adp + 1) & 0xFFFF;
      return v;
    }
    return this.readLatch;
  }

  writeCommand(c: number): void {
    const [d1 = 0, d2 = 0] = this.params;
    const word = d1 | (d2 << 8);
    this.params = [];
    switch (c & 0xF0) {
      case 0x20:
        if (c === 0x21) { this.cursorX = d1 & 0x7F; this.cursorY = d2 & 0x7F; }
        else if (c === 0x22) this.offset = d1 & 0x1F;
        else if (c === 0x24) this.adp = word;
        return;
      case 0x40:
        if (c === 0x40) this.textHome = word;
        else if (c === 0x41) this.textArea = d1;
        else if (c === 0x42) this.graphicHome = word;
        else if (c === 0x43) this.graphicArea = d1;
        return;
      case 0x80: this.mode = c & 0x0F; return;
      case 0x90: this.display = c & 0x0F; return;
      case 0xA0: if (c < 0xA8) this.cursorLines = (c & 7) + 1; return;
      case 0xB0:
        if (c === 0xB0) { this.autoWrite = true; this.autoRead = false; }
        else if (c === 0xB1) { this.autoRead = true; this.autoWrite = false; }
        else if (c === 0xB2 || c === 0xB3) { this.autoWrite = this.autoRead = false; }
        return;
      case 0xC0:
        switch (c) {
          case 0xC0: this.ram[this.adp] = d1; this.adp = (this.adp + 1) & 0xFFFF; break;
          case 0xC1: this.readLatch = this.ram[this.adp]; this.adp = (this.adp + 1) & 0xFFFF; break;
          case 0xC2: this.ram[this.adp] = d1; this.adp = (this.adp - 1) & 0xFFFF; break;
          case 0xC3: this.readLatch = this.ram[this.adp]; this.adp = (this.adp - 1) & 0xFFFF; break;
          case 0xC4: this.ram[this.adp] = d1; break;
          case 0xC5: this.readLatch = this.ram[this.adp]; break;
        }
        return;
      case 0xF0: {
        const bit = 1 << (c & 7);
        if (c & 0x08) this.ram[this.adp] |= bit;
        else this.ram[this.adp] &= ~bit;
        return;
      }
    }
  }

  /** riga di pixel dal generatore di caratteri */
  private charRow(code: number, line: number): number {
    if (code < 0x80 && !(this.mode & 0x08)) return glyph(code + 0x20)[line] >> 1; // 5x8 centrato in 8
    return this.ram[((this.offset << 11) + code * 8 + line) & 0xFFFF];
  }

  /** disegna il display in out (1 = pixel acceso) */
  render(out: Uint8Array, blinkPhase: boolean): void {
    out.fill(0);
    const textOn = (this.display & 0x04) !== 0;
    const graphOn = (this.display & 0x08) !== 0;
    const op = this.mode & 0x07;
    for (let y = 0; y < T6963_H; y++) {
      const row = y >> 3, line = y & 7;
      for (let col = 0; col < T6963_W / 8; col++) {
        let t = 0, g = 0;
        if (textOn) t = this.charRow(this.ram[(this.textHome + row * this.textArea + col) & 0xFFFF], line);
        if (graphOn) g = this.ram[(this.graphicHome + y * this.graphicArea + col) & 0xFFFF];
        let v: number;
        if (!textOn) v = g;
        else if (!graphOn || op === 4) v = t;
        else if (op === 1) v = t ^ g;
        else if (op === 3) v = t & g;
        else v = t | g;
        // cursore: le ultime cursorLines righe della cella
        if ((this.display & 0x02) && col === this.cursorX && row === this.cursorY &&
            line >= 8 - this.cursorLines && (!(this.display & 0x01) || blinkPhase)) v = 0xFF;
        const o = y * T6963_W + col * 8;
        for (let b = 0; b < 8; b++) out[o + b] = (v >> (7 - b)) & 1;
      }
    }
  }
}
