// HD44780U - character LCD controller (16x2)
//
//   bus     8 bit, or 4 bit (DB4-DB7, high nibble first) after a Function Set with DL = 0
//   latch   on the falling edge of E; with RW = 1 the data is driven while E is high
//   RS = 0  instructions / read busy flag + address counter (BF always 0: no waiting)
//   RS = 1  data in DDRAM or CGRAM
//   DDRAM   80 bytes: line 1 $00-$27, line 2 $40-$67; the display shows 16 columns from the shift
//   CGRAM   8 custom 5x8 characters (codes 0-7 and 8-15)
// At power-on the interface is 8 bit, like on the real chip.

export class HD44780 {
  readonly ddram = new Uint8Array(0x80).fill(0x20);
  readonly cgram = new Uint8Array(64);
  /** address counter */
  ac = 0;
  /** true = the last address set was in CGRAM */
  cgMode = false;
  displayOn = false;
  cursorOn = false;
  blinkOn = false;
  twoLines = false;
  increment = true;
  shiftDisplay = false;
  /** display shift (columns) */
  shift = 0;
  eightBit = true;

  private e = 0;
  private nibbleHigh = true;   // in 4-bit mode: the next nibble is the high one
  private latchedHigh = 0;
  private readNibbleHigh = true;

  reset(): void {
    this.ddram.fill(0x20);
    this.ac = 0;
    this.cgMode = false;
    this.displayOn = this.cursorOn = this.blinkOn = false;
    this.twoLines = false;
    this.increment = true;
    this.shiftDisplay = false;
    this.shift = 0;
    this.eightBit = true;
    this.nibbleHigh = true;
    this.readNibbleHigh = true;
    this.e = 0;
  }

  /**
   * updates the pins; data = DB0-DB7 (in 4-bit mode only DB4-DB7 matter).
   * Returns the value the display drives on the bus (DB0-DB7) or -1 if it does not drive it.
   */
  pins(rs: number, rw: number, e: number, data: number): number {
    e = e ? 1 : 0;
    const falling = this.e === 1 && e === 0;
    const rising = this.e === 0 && e === 1;
    this.e = e;
    if (rw) {
      // read: the display drives the bus while E is high
      if (!e) {
        if (falling) {
          if (this.eightBit) {
            if (rs) this.moveAc();
          } else if (this.readNibbleHigh) {
            this.readNibbleHigh = false;
          } else {
            this.readNibbleHigh = true;
            if (rs) this.moveAc();
          }
        }
        return -1;
      }
      const v = rs ? this.readData() : this.ac & 0x7F; // BF = 0
      if (this.eightBit) return v;
      return this.readNibbleHigh ? v & 0xF0 : (v << 4) & 0xF0;
    }
    if (rising) this.readNibbleHigh = true; // a write realigns the read sequence
    if (!falling) return -1;
    if (this.eightBit) {
      this.write(rs, data & 0xFF);
    } else if (this.nibbleHigh) {
      this.latchedHigh = data & 0xF0;
      this.nibbleHigh = false;
    } else {
      this.nibbleHigh = true;
      this.write(rs, this.latchedHigh | ((data >> 4) & 0x0F));
    }
    return -1;
  }

  private readData(): number {
    return this.cgMode ? this.cgram[this.ac & 0x3F] : this.ddram[this.ac & 0x7F];
  }

  private moveAc(): void {
    if (this.cgMode) {
      this.ac = (this.ac + (this.increment ? 1 : -1)) & 0x3F;
      return;
    }
    let a = this.ac + (this.increment ? 1 : -1);
    if (this.twoLines) {
      // jumps between the two lines: $27 -> $40, $67 -> $00 (and backwards)
      if (a === 0x28) a = 0x40;
      else if (a === 0x68) a = 0x00;
      else if (a === 0x3F) a = 0x27;
      else if (a < 0) a = 0x67;
    } else {
      if (a > 0x4F) a = 0;
      else if (a < 0) a = 0x4F;
    }
    this.ac = a;
  }

  write(rs: number, v: number): void {
    if (rs) {
      if (this.cgMode) this.cgram[this.ac & 0x3F] = v & 0x1F;
      else this.ddram[this.ac & 0x7F] = v;
      this.moveAc();
      if (this.shiftDisplay && !this.cgMode) this.shift += this.increment ? 1 : -1;
      return;
    }
    if (v & 0x80) {                         // Set DDRAM address
      this.ac = v & 0x7F;
      this.cgMode = false;
    } else if (v & 0x40) {                  // Set CGRAM address
      this.ac = v & 0x3F;
      this.cgMode = true;
    } else if (v & 0x20) {                  // Function set
      this.eightBit = (v & 0x10) !== 0;
      this.twoLines = (v & 0x08) !== 0;
      this.nibbleHigh = true;
    } else if (v & 0x10) {                  // Cursor / display shift
      const right = (v & 0x04) !== 0;
      if (v & 0x08) this.shift += right ? -1 : 1;
      else this.moveCursor(right);
    } else if (v & 0x08) {                  // Display on/off control
      this.displayOn = (v & 0x04) !== 0;
      this.cursorOn = (v & 0x02) !== 0;
      this.blinkOn = (v & 0x01) !== 0;
    } else if (v & 0x04) {                  // Entry mode set
      this.increment = (v & 0x02) !== 0;
      this.shiftDisplay = (v & 0x01) !== 0;
    } else if (v & 0x02) {                  // Return home
      this.ac = 0;
      this.cgMode = false;
      this.shift = 0;
    } else if (v & 0x01) {                  // Clear display
      this.ddram.fill(0x20);
      this.ac = 0;
      this.cgMode = false;
      this.shift = 0;
      this.increment = true;
    }
  }

  private moveCursor(right: boolean): void {
    const inc = this.increment;
    this.increment = right;
    const cg = this.cgMode;
    this.cgMode = false;
    this.moveAc();
    this.cgMode = cg;
    this.increment = inc;
  }

  /** code of the character visible at row r (0-1), column c (0-15) */
  charAt(r: number, c: number): number {
    const width = this.twoLines ? 40 : 80;
    const col = (((c + this.shift) % width) + width) % width;
    return this.ddram[(r ? 0x40 : 0) + col];
  }

  /** visible cursor cell [row, column] (or null) */
  cursorCell(): [number, number] | null {
    if (this.cgMode) return null;
    const row = this.ac >= 0x40 ? 1 : 0;
    const width = this.twoLines ? 40 : 80;
    const col = ((((this.ac & 0x3F) - this.shift) % width) + width) % width;
    return col < 16 && (row === 0 || this.twoLines) ? [row, col] : null;
  }
}
