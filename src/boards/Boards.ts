// Boards of the BO6502 / miniVIC system
//
// Each board decodes an address space starting at "base" and uses only the low
// address bits, like the 74LS138s of the real boards: addresses repeat (mirror)
// inside the decoded space.

import { Board, BoardContext, BoardType, IrqLine } from '../core/Board';
import { TMS9918A } from '../devices/TMS9918A';
import { ACIA6551 } from '../devices/ACIA6551';
import { VIA6522 } from '../devices/VIA6522';
import { KeyboardPS2 } from '../devices/KeyboardPS2';
import { SDCard } from '../devices/SDCard';
import { AY38910 } from '../devices/AY38910';

export abstract class BaseBoard implements Board {
  abstract readonly type: BoardType;
  abstract readonly label: string;
  abstract readonly size: number;
  base: number;
  irqLine: IrqLine;
  protected ctx!: BoardContext;

  constructor(base: number, irqLine: IrqLine = 'none') {
    this.base = base;
    this.irqLine = irqLine;
  }

  attach(ctx: BoardContext): void {
    this.ctx = ctx;
  }

  protected interrupt(active: boolean): void {
    this.ctx?.setInterrupt(this, active);
  }

  abstract reset(): void;
  abstract read(offset: number): number;
  abstract write(offset: number, value: number): void;
  abstract peek(offset: number): number;
}

// ---------------------------------------------------------------- VDU TMS9918A
/** VDU: A0 = 0 data port, A0 = 1 register/status port. INT on IRQ (BO6502) or NMI (miniVIC). */
export class VduBoard extends BaseBoard {
  readonly type = 'vdu';
  readonly label = 'VDU TMS9918A';
  readonly size = 0x1000;
  readonly vdp = new TMS9918A();

  constructor(base = 0xB000, irqLine: IrqLine = 'irq') {
    super(base, irqLine);
    this.vdp.onInterrupt = on => this.interrupt(on);
  }

  reset(): void { this.vdp.reset(); }
  read(o: number): number { return o & 1 ? this.vdp.readStatus() : this.vdp.readData(); }
  write(o: number, v: number): void { if (o & 1) this.vdp.writeControl(v); else this.vdp.writeData(v); }
  peek(o: number): number { return o & 1 ? this.vdp.peekStatus() : 0xFF; }
}

// ---------------------------------------------------------------- SERIAL 6551
export class SerialBoard extends BaseBoard {
  readonly type = 'serial';
  readonly label = 'Serial W65C51 + MAX232';
  readonly size = 0x1000;
  readonly acia = new ACIA6551();

  constructor(base = 0xC000) {
    super(base, 'irq');
    this.acia.onIrq = on => this.interrupt(on);
  }

  reset(): void { this.acia.reset(); }
  read(o: number): number { return this.acia.read(o); }
  write(o: number, v: number): void { this.acia.write(o, v); }
  peek(o: number): number { return this.acia.peek(o); }
}

// ---------------------------------------------------------------- KEYb PS/2
export class KeyboardBoard extends BaseBoard {
  readonly type = 'keyboard';
  readonly label = 'KEYb PS/2 W65C22';
  readonly size = 0x10;
  readonly via = new VIA6522();
  readonly keyboard = new KeyboardPS2(this.via);

  constructor(base = 0xD180) {
    super(base, 'irq');
    this.via.onIrq = on => this.interrupt(on);
  }

  reset(): void { this.via.reset(); this.keyboard.reset(); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); this.keyboard.tick(n); }
}

// ---------------------------------------------------------------- JOYSTICK
/** joystick bits (1 = pressed in the state; on the pins the logic is active low) */
export const JOY_UP = 0x01;
export const JOY_DOWN = 0x02;
export const JOY_LEFT = 0x04;
export const JOY_RIGHT = 0x08;
export const JOY_FIRE1 = 0x10;
export const JOY_FIRE2 = 0x20;
/** Arcade6502 control panels only (the miniVIC board has 6 inputs per port) */
export const JOY_FIRE3 = 0x40;
export const JOY_START = 0x80;

/**
 * two Sega Master System joysticks: P1 on port A, P2 on port B (bits 0-5).
 * Arcade6502: two JAMMA control panels on the same VIA with all 8 bits (bit 6 button 3, bit 7 START).
 */
export class JoystickBoard extends BaseBoard {
  readonly type = 'joystick';
  readonly label = 'Joystick SMS W65C22';
  readonly size = 0x10;
  readonly via = new VIA6522();
  /** state of the two joysticks (index 0 = P1, 1 = P2), 1 = pressed */
  readonly state = [0, 0];
  /** inputs wired on each port: 6 (miniVIC/BO6502 board) or 8 (Arcade6502) */
  readonly mask: number;

  constructor(base = 0xD1A0, inputs = 6) {
    super(base, 'irq');
    this.mask = (1 << inputs) - 1;
    this.via.onIrq = on => this.interrupt(on);
  }

  setJoystick(player: number, bits: number): void {
    this.state[player] = bits & this.mask;
    this.via.inputA = ~this.state[0] & 0xFF;
    this.via.inputB = ~this.state[1] & 0xFF;
  }

  reset(): void { this.via.reset(); this.setJoystick(0, this.state[0]); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); }
}

// ---------------------------------------------------------------- SD CARD
const SD_MISO = 0x02; // PA1
const SD_MOSI = 0x04; // PA2
const SD_SCK = 0x08;  // PA3
const SD_CS = 0x10;   // PA4

/** Arcade6502 cabinet switches on the free pins of the SD VIA port A (1 = pressed; active low on the pins) */
export const SW_TEST = 0x01;     // PA0
export const SW_SERVICE = 0x20;  // PA5
export const SW_COIN1 = 0x40;    // PA6
export const SW_COIN2 = 0x80;    // PA7
const SW_PINS = SW_TEST | SW_SERVICE | SW_COIN1 | SW_COIN2;

/**
 * SD card on port A of a W65C22, bit-banged SPI (PA1 MISO, PA2 MOSI, PA3 SCK, PA4 CS).
 * Arcade6502: PA0 and PA5-PA7 read the cabinet switches (TEST, SERVICE, COIN 1, COIN 2).
 */
export class SdCardBoard extends BaseBoard {
  readonly type = 'sdcard';
  readonly label = 'SD Card W65C22';
  readonly size = 0x10;
  readonly via = new VIA6522();
  readonly card = new SDCard();
  /** the cabinet switches are wired (Arcade6502) */
  readonly hasSwitches: boolean;
  /** switches pressed now (SW_* bits) */
  private switches = 0;

  constructor(base = 0xD1B0, hasSwitches = false) {
    super(base, 'irq');
    this.hasSwitches = hasSwitches;
    this.via.onIrq = on => this.interrupt(on);
    this.via.onPortAChange = v => {
      this.card.setPins(v & SD_CS, v & SD_SCK, v & SD_MOSI);
      this.updatePins();
    };
  }

  /** cabinet switches (SW_* bits, 1 = pressed); ignored without the Arcade6502 wiring */
  setSwitches(bits: number): void {
    this.switches = this.hasSwitches ? bits & SW_PINS : 0;
    this.updatePins();
  }

  private updatePins(): void {
    this.via.inputA = (this.card.miso ? 0xFF : ~SD_MISO & 0xFF) & ~this.switches;
  }

  reset(): void { this.via.reset(); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); }
}

// ---------------------------------------------------------------- AUDIO 2 x AY-3-8910
/**
 * Stereo audio board: A2 selects the chip (0 = right, 1 = left),
 * A0 selects register latch (0) or data (1). E.g. miniVIC: $D380/$D381 right, $D384/$D385 left.
 * The two PSGs advance together to the current CPU cycle before every access.
 */
export class AudioBoard extends BaseBoard {
  readonly type = 'audio';
  readonly label = 'Audio 2 x AY-3-8910';
  readonly size = 0x10;
  readonly right = new AY38910();
  readonly left = new AY38910();
  /** PSG clock in Hz (on the real boards it is the system clock) */
  psgHz = 1_000_000;

  private lastCycle = 0;
  private phase = 0;

  constructor(base = 0xD1C0) {
    super(base, 'none');
  }

  attach(ctx: BoardContext): void {
    super.attach(ctx);
    this.psgHz = ctx.cpuHz;
    ctx.audio.inputRate = this.psgHz / 8;
    this.lastCycle = ctx.cycles();
  }

  reset(): void {
    this.left.reset();
    this.right.reset();
    if (this.ctx) this.lastCycle = this.ctx.cycles();
  }

  private chip(o: number): AY38910 {
    return o & 0x04 ? this.left : this.right;
  }

  read(o: number): number {
    this.sync();
    return o & 1 ? this.chip(o).readData() : 0xFF;
  }

  write(o: number, v: number): void {
    this.sync();
    const c = this.chip(o);
    if (o & 1) c.writeData(v);
    else c.latch(v);
  }

  peek(o: number): number {
    return o & 1 ? this.chip(o).readData() : 0xFF;
  }

  /** brings the PSGs to the current CPU cycle, producing the audio samples */
  sync(): void {
    const now = this.ctx.cycles();
    const elapsed = now - this.lastCycle;
    this.lastCycle = now;
    if (elapsed <= 0) return;
    this.phase += elapsed * (this.psgHz / this.ctx.cpuHz);
    const L = this.left.out;
    const R = this.right.out;
    const sink = this.ctx.audio;
    while (this.phase >= 8) {
      this.phase -= 8;
      this.left.tick();
      this.right.tick();
      sink.push((L[0] + L[1] + L[2]) / 3, (R[0] + R[1] + R[2]) / 3);
    }
  }

  endFrame(): void {
    this.sync();
  }
}
