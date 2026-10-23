// TMS9918A - Video Display Processor (NTSC)
//
// Scanline rendering, kept in sync with the CPU by the machine:
// register or VRAM changes in mid-screen take effect from the next line.
//   modes    Graphics I, Graphics II, Multicolor, Text (+ undocumented M3 combinations)
//   sprites  32 sprites, 8x8 / 16x16, magnified x2, 4 per line limit with the 5S flag
//            and the fifth sprite number, collision (even with colour 0), early clock
//   ports    two-write latch, read-ahead buffer, first write updating the address
//            low byte immediately (like the real chip)
//   INT      F flag at the end of line 192, active if R1 bit 5; cleared by reading the status

/** TMS9918A palette (measured RGB values, as in MAME / openMSX) */
export const TMS_PALETTE: readonly number[][] = [
  [0, 0, 0],       // 0 transparent
  [0, 0, 0],       // 1 black
  [33, 200, 66],   // 2 medium green
  [94, 220, 120],  // 3 light green
  [84, 85, 237],   // 4 dark blue
  [125, 118, 252], // 5 light blue
  [212, 82, 77],   // 6 dark red
  [66, 235, 245],  // 7 cyan
  [252, 85, 84],   // 8 medium red
  [255, 121, 120], // 9 light red
  [212, 193, 84],  // 10 dark yellow
  [230, 206, 128], // 11 light yellow
  [33, 176, 59],   // 12 dark green
  [201, 91, 186],  // 13 magenta
  [204, 204, 204], // 14 grey
  [255, 255, 255], // 15 white
];

export const TMS_LINES = 262;          // lines per NTSC frame
export const TMS_ACTIVE_LINES = 192;
export const BORDER_X = 16;            // border shown on the left and right
export const BORDER_Y = 24;            // border shown above and below
export const SCREEN_W = 256 + BORDER_X * 2;
export const SCREEN_H = 192 + BORDER_Y * 2;

export class TMS9918A {
  readonly vram = new Uint8Array(0x4000);
  readonly reg = new Uint8Array(8);
  status = 0;

  /** current frame as colour indices (0-15), border included */
  readonly frame = new Uint8Array(SCREEN_W * SCREEN_H);
  /** called when the INT line changes (active = true) */
  onInterrupt: (active: boolean) => void = () => {};

  private addr = 0;
  private latch = false;
  private first = 0;
  private buffer = 0;
  private intLine = false;

  // pixels already taken by a sprite on the line (for collisions)
  private readonly spriteMask = new Uint8Array(256);

  reset(): void {
    this.reg.fill(0);
    this.status = 0;
    this.addr = 0;
    this.latch = false;
    this.first = 0;
    this.buffer = 0;
    this.updateInt();
  }

  // ---------------- CPU ports ----------------
  /** data port (MODE = 0) */
  readData(): number {
    this.latch = false;
    const v = this.buffer;
    this.buffer = this.vram[this.addr];
    this.addr = (this.addr + 1) & 0x3FFF;
    return v;
  }

  writeData(v: number): void {
    this.latch = false;
    this.vram[this.addr] = v;
    this.buffer = v;
    this.addr = (this.addr + 1) & 0x3FFF;
  }

  /** control port (MODE = 1): status read */
  readStatus(): number {
    const v = this.status;
    this.status &= 0x1F;     // clears F, 5S and C
    this.latch = false;
    this.updateInt();
    return v;
  }

  /** status value without side effects (debugger) */
  peekStatus(): number {
    return this.status;
  }

  writeControl(v: number): void {
    if (!this.latch) {
      this.first = v;
      this.addr = (this.addr & 0x3F00) | v;
      this.latch = true;
      return;
    }
    this.latch = false;
    if (v & 0x80) {
      this.writeRegister(v & 0x07, this.first);
      return;
    }
    this.addr = ((v & 0x3F) << 8) | this.first;
    if (!(v & 0x40)) {
      // setup for reading: read-ahead
      this.buffer = this.vram[this.addr];
      this.addr = (this.addr + 1) & 0x3FFF;
    }
  }

  writeRegister(r: number, v: number): void {
    this.reg[r] = v;
    if (r === 1) this.updateInt();
  }

  get vramAddress(): number {
    return this.addr;
  }

  private updateInt(): void {
    const on = (this.reg[1] & 0x20) !== 0 && (this.status & 0x80) !== 0;
    if (on !== this.intLine) {
      this.intLine = on;
      this.onInterrupt(on);
    }
  }

  get interruptActive(): boolean {
    return this.intLine;
  }

  // ---------------- timing ----------------
  /**
   * Called by the machine at the end of every scanline (0..261).
   * Lines 0-191 are the active area; vblank starts at the end of line 191.
   */
  endOfLine(line: number): void {
    if (line < TMS_ACTIVE_LINES) {
      this.renderLine(line);
      if (line === TMS_ACTIVE_LINES - 1) {
        this.status |= 0x80;
        this.updateInt();
      }
    } else {
      // visible bottom and top border
      const y = line < TMS_ACTIVE_LINES + BORDER_Y
        ? line + BORDER_Y
        : line >= TMS_LINES - BORDER_Y ? line - (TMS_LINES - BORDER_Y) : -1;
      if (y >= 0) this.frame.fill(this.reg[7] & 0x0F, y * SCREEN_W, (y + 1) * SCREEN_W);
    }
  }

  // ---------------- rendering ----------------
  private get mode(): number {
    // bit 0 = M1 (text), bit 1 = M2 (multicolor), bit 2 = M3 (graphics II)
    return ((this.reg[1] >> 4) & 1) | ((this.reg[1] >> 2) & 2) | ((this.reg[0] << 1) & 4);
  }

  private renderLine(y: number): void {
    const r = this.reg;
    const vr = this.vram;
    const out = this.frame;
    const backdrop = r[7] & 0x0F;
    const row0 = (y + BORDER_Y) * SCREEN_W;
    out.fill(backdrop, row0, row0 + BORDER_X);
    out.fill(backdrop, row0 + BORDER_X + 256, row0 + SCREEN_W);
    const o = row0 + BORDER_X;

    if (!(r[1] & 0x40)) {           // screen blanked (BLANK)
      out.fill(backdrop, o, o + 256);
      return;
    }

    const mode = this.mode;
    const nt = (r[2] & 0x0F) << 10;
    const row = y >> 3;
    const line = y & 7;
    const third = (row >> 3) << 8;  // for the M3 modes (tables split into 3 thirds)
    const m3 = (mode & 4) !== 0;

    if (mode & 1) {
      // ---------- TEXT (M1): 40 columns of 6 pixels, 8-pixel border ----------
      const fg = (r[7] >> 4) || backdrop;
      const bg = backdrop;
      const pgBase = m3 ? (r[4] & 0x04) << 11 : (r[4] & 0x07) << 11;
      const pmask = m3 ? ((r[4] & 0x03) << 8) | 0xFF : 0xFF;
      out.fill(bg, o, o + 8);
      out.fill(bg, o + 248, o + 256);
      for (let col = 0; col < 40; col++) {
        const name = vr[nt + row * 40 + col];
        const idx = m3 ? (third | name) & pmask : name;
        const pat = vr[(pgBase + idx * 8 + line) & 0x3FFF];
        const p = o + 8 + col * 6;
        for (let b = 0; b < 6; b++) out[p + b] = (pat & (0x80 >> b)) ? fg : bg;
      }
      return; // no sprites in text mode
    }

    if (mode & 2) {
      // ---------- MULTICOLOR (M2): 4x4 blocks ----------
      const pgBase = (r[4] & 0x07) << 11;
      for (let col = 0; col < 32; col++) {
        const name = vr[nt + row * 32 + col];
        const pa = m3
          ? ((r[4] & 0x04) << 11) + (((third | name) & (((r[4] & 0x03) << 8) | 0xFF)) << 3)
          : pgBase + name * 8;
        const v = vr[(pa + ((row & 3) << 1) + (line >> 2)) & 0x3FFF];
        const left = (v >> 4) || backdrop;
        const right = (v & 0x0F) || backdrop;
        const p = o + col * 8;
        out[p] = out[p + 1] = out[p + 2] = out[p + 3] = left;
        out[p + 4] = out[p + 5] = out[p + 6] = out[p + 7] = right;
      }
    } else if (m3) {
      // ---------- GRAPHICS II ----------
      const ct = (r[3] & 0x80) << 6;
      const pg = (r[4] & 0x04) << 11;
      const cmask = ((r[3] & 0x7F) << 3) | 0x07;
      const pmask = ((r[4] & 0x03) << 8) | 0xFF;
      for (let col = 0; col < 32; col++) {
        const idx = third | vr[nt + row * 32 + col];
        const pat = vr[pg + ((idx & pmask) << 3) + line];
        const cb = vr[ct + ((idx & cmask) << 3) + line];
        const fg = (cb >> 4) || backdrop;
        const bg = (cb & 0x0F) || backdrop;
        const p = o + col * 8;
        for (let b = 0; b < 8; b++) out[p + b] = (pat & (0x80 >> b)) ? fg : bg;
      }
    } else {
      // ---------- GRAPHICS I ----------
      const ct = r[3] << 6;
      const pg = (r[4] & 0x07) << 11;
      for (let col = 0; col < 32; col++) {
        const name = vr[nt + row * 32 + col];
        const pat = vr[pg + name * 8 + line];
        const cb = vr[ct + (name >> 3)];
        const fg = (cb >> 4) || backdrop;
        const bg = (cb & 0x0F) || backdrop;
        const p = o + col * 8;
        for (let b = 0; b < 8; b++) out[p + b] = (pat & (0x80 >> b)) ? fg : bg;
      }
    }

    this.renderSprites(y, o);
  }

  private renderSprites(y: number, o: number): void {
    const r = this.reg;
    const vr = this.vram;
    const out = this.frame;
    const sat = (r[5] & 0x7F) << 7;
    const spg = (r[6] & 0x07) << 11;
    const big = (r[1] & 0x02) !== 0;
    const mag = (r[1] & 0x01) !== 0;
    const size = (big ? 16 : 8) << (mag ? 1 : 0);
    const mask = this.spriteMask;
    mask.fill(0);

    let count = 0;
    let s = 0;
    for (; s < 32; s++) {
      const a = sat + s * 4;
      let sy = vr[a];
      if (sy === 0xD0) break;               // end of the list
      if (sy > 0xE0) sy -= 256;             // sprite partly above the screen
      const top = sy + 1;
      if (y < top || y >= top + size) continue;
      if (++count > 4) {
        // fifth sprite on the line: not drawn
        if (!(this.status & 0x40)) this.status = (this.status & 0xA0) | 0x40 | s;
        break;
      }
      let sx = vr[a + 1];
      let name = vr[a + 2];
      const attr = vr[a + 3];
      if (attr & 0x80) sx -= 32;            // early clock
      const c = attr & 0x0F;
      if (big) name &= 0xFC;
      const py = (y - top) >> (mag ? 1 : 0);
      const pa = spg + name * 8 + py;
      const bits = big ? (vr[pa] << 8) | vr[pa + 16] : vr[pa] << 8;
      const w = big ? 16 : 8;
      for (let px = 0; px < w; px++) {
        if (!(bits & (0x8000 >> px))) continue;
        for (let m = 0; m < (mag ? 2 : 1); m++) {
          const x = sx + (mag ? px * 2 + m : px);
          if (x < 0 || x > 255) continue;
          if (mask[x]) {
            this.status |= 0x20;            // collision
            continue;
          }
          mask[x] = 1;
          if (c) out[o + x] = c;
        }
      }
    }
    // if there was no fifth sprite, the low 5 bits hold the last sprite examined
    if (!(this.status & 0x40)) this.status = (this.status & 0xE0) | Math.min(s, 31);
  }
}
