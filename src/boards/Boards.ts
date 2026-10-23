// Schede del sistema BO6502 / miniVIC
//
// Ogni scheda decodifica uno spazio di indirizzi a partire da "base" e usa solo i bit
// bassi dell'indirizzo, come i 74LS138 delle schede reali: gli indirizzi si ripetono
// (mirror) all'interno dello spazio decodificato.

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
/** VDU: A0 = 0 porta dati, A0 = 1 porta registri/stato. INT su IRQ (BO6502) o NMI (miniVIC). */
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
/** bit dei joystick (1 = premuto nello stato; sui pin la logica e' attiva bassa) */
export const JOY_UP = 0x01;
export const JOY_DOWN = 0x02;
export const JOY_LEFT = 0x04;
export const JOY_RIGHT = 0x08;
export const JOY_FIRE1 = 0x10;
export const JOY_FIRE2 = 0x20;

/** due joystick Sega Master System: P1 su porta A, P2 su porta B */
export class JoystickBoard extends BaseBoard {
  readonly type = 'joystick';
  readonly label = 'Joystick SMS W65C22';
  readonly size = 0x10;
  readonly via = new VIA6522();
  /** stato dei due joystick (indice 0 = P1, 1 = P2), 1 = premuto */
  readonly state = [0, 0];

  constructor(base = 0xD1A0) {
    super(base, 'irq');
    this.via.onIrq = on => this.interrupt(on);
  }

  setJoystick(player: number, bits: number): void {
    this.state[player] = bits & 0x3F;
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

/** SD card su porta A di una W65C22, SPI a bit (PA1 MISO, PA2 MOSI, PA3 SCK, PA4 CS) */
export class SdCardBoard extends BaseBoard {
  readonly type = 'sdcard';
  readonly label = 'SD Card W65C22';
  readonly size = 0x10;
  readonly via = new VIA6522();
  readonly card = new SDCard();

  constructor(base = 0xD1B0) {
    super(base, 'irq');
    this.via.onIrq = on => this.interrupt(on);
    this.via.onPortAChange = v => {
      this.card.setPins(v & SD_CS, v & SD_SCK, v & SD_MOSI);
      this.via.inputA = this.card.miso ? 0xFF : ~SD_MISO & 0xFF;
    };
  }

  reset(): void { this.via.reset(); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); }
}

// ---------------------------------------------------------------- AUDIO 2 x AY-3-8910
/**
 * Scheda audio stereo: A2 sceglie il chip (0 = destro, 1 = sinistro),
 * A0 sceglie latch del registro (0) o dato (1). Es. miniVIC: $D380/$D381 destro, $D384/$D385 sinistro.
 * I due PSG avanzano insieme al ciclo CPU corrente prima di ogni accesso.
 */
export class AudioBoard extends BaseBoard {
  readonly type = 'audio';
  readonly label = 'Audio 2 x AY-3-8910';
  readonly size = 0x10;
  readonly right = new AY38910();
  readonly left = new AY38910();
  /** clock dei PSG in Hz (sulle schede reali e' il clock di sistema) */
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

  /** porta i PSG al ciclo CPU corrente, producendo i campioni audio */
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
