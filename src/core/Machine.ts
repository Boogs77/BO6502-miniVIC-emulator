// Machine - CPU, memory, bus and boards of a BO6502 / miniVIC machine
//
// Bus: decoding works in 16-byte blocks. Each block points to a board or to
// RAM ($0000-$7FFF) or ROM ($8000-$FFFF). In the ROM "holes" (the I/O areas disabled
// with the J-CS jumpers of the multi ROM) without a board, the open bus is read.
// Timing: one NTSC frame = 262 lines; at the end of each line the VDP draws the line.

import { W65C02 } from '../cpu/W65C02';
import { Board, BoardContext } from './Board';
import { StereoSink } from '../audio/StereoSink';
import { TMS_LINES } from '../devices/TMS9918A';
import { VduBoard } from '../boards/Boards';

export const NTSC_FPS = 59.922743;

export interface MachineOptions {
  cpuHz: number;
  /** areas without ROM ([start, end] inclusive) */
  romHoles: Array<[number, number]>;
}

export class Machine {
  readonly cpu: W65C02;
  readonly ram = new Uint8Array(0x8000);
  readonly rom = new Uint8Array(0x8000).fill(0xFF);
  readonly audio = new StereoSink();
  readonly boards: Board[] = [];
  readonly cpuHz: number;
  ramEnabled = true;
  romEnabled = true;

  /** number of frames executed */
  frame = 0;
  /** last value on the data bus (for the open bus) */
  private busValue = 0xFF;

  private readonly map = new Int16Array(4096).fill(-1);
  private readonly romHole = new Uint8Array(4096);
  private tickers: Board[] = [];
  private frameEnders: Board[] = [];
  private irqSources = new Set<Board>();
  private nmiSources = new Set<Board>();
  private readonly ctx: BoardContext;
  private lineCycles: number;
  private lineTarget = 0;

  /** called when the CPU reads/writes (only when set: for breakpoints) */
  watch: ((addr: number, write: boolean) => void) | null = null;

  constructor(opts: MachineOptions) {
    this.cpuHz = opts.cpuHz;
    this.lineCycles = opts.cpuHz / (NTSC_FPS * TMS_LINES);
    for (const [a, b] of opts.romHoles) this.romHole.fill(1, a >> 4, (b >> 4) + 1);
    this.cpu = new W65C02({
      read: a => this.read(a),
      write: (a, v) => this.write(a, v),
    });
    const self = this;
    this.ctx = {
      cycles: () => this.cpu.cycles,
      cpuHz: opts.cpuHz,
      audio: this.audio,
      setInterrupt(board, active) { self.setInterrupt(board, active); },
    };
  }

  // ---------------- configuration ----------------
  addBoard(board: Board): void {
    this.boards.push(board);
    board.attach(this.ctx);
    this.rebuildMap();
  }

  /** rebuilds the bus map (after an address change) */
  rebuildMap(): void {
    this.map.fill(-1);
    this.boards.forEach((b, i) => {
      const first = b.base >> 4;
      const last = Math.min(4095, (b.base + b.size - 1) >> 4);
      for (let k = first; k <= last; k++) if (this.map[k] < 0) this.map[k] = i;
    });
    this.tickers = this.boards.filter(b => b.tick);
    this.frameEnders = this.boards.filter(b => b.endFrame);
  }

  /** first board of a type */
  board<T extends Board>(type: Board['type']): T | undefined {
    return this.boards.find(b => b.type === type) as T | undefined;
  }

  get vdu(): VduBoard | undefined {
    return this.board<VduBoard>('vdu');
  }

  /** board that decodes an address (for the debugger) */
  boardAt(addr: number): Board | undefined {
    const i = this.map[addr >> 4];
    return i >= 0 ? this.boards[i] : undefined;
  }

  loadRom(data: Uint8Array): void {
    this.rom.fill(0xFF);
    // an image shorter than 32 KB is aligned to the end (the vectors are at $FFFA)
    const d = data.length > 0x8000 ? data.subarray(data.length - 0x8000) : data;
    this.rom.set(d, 0x8000 - d.length);
  }

  /** writes data straight into memory (RAM only; addresses >= $8000 are skipped) */
  poke(addr: number, data: ArrayLike<number>): void {
    for (let i = 0; i < data.length; i++) {
      const a = (addr + i) & 0xFFFF;
      if (a < 0x8000) this.ram[a] = data[i];
    }
  }

  // ---------------- interrupt ----------------
  private setInterrupt(board: Board, active: boolean): void {
    if (board.irqLine === 'nmi') {
      const was = this.nmiSources.size > 0;
      if (active) this.nmiSources.add(board);
      else this.nmiSources.delete(board);
      // NMI is edge-triggered: it fires when the (wired-OR) line becomes active
      if (!was && this.nmiSources.size > 0) this.cpu.nmi();
    } else if (board.irqLine === 'irq') {
      if (active) this.irqSources.add(board);
      else this.irqSources.delete(board);
      this.cpu.irq = this.irqSources.size > 0;
    }
  }

  // ---------------- bus ----------------
  read(addr: number): number {
    const i = this.map[addr >> 4];
    let v: number;
    if (i >= 0) {
      const b = this.boards[i];
      v = b.read((addr - b.base) & 0xFFFF);
    } else if (addr < 0x8000) {
      v = this.ramEnabled ? this.ram[addr] : this.busValue;
    } else if (this.romEnabled && !this.romHole[addr >> 4]) {
      v = this.rom[addr - 0x8000];
    } else {
      v = addr >> 8; // open bus: the last byte read remains (usually the address high byte)
    }
    this.busValue = v;
    if (this.watch) this.watch(addr, false);
    return v;
  }

  write(addr: number, v: number): void {
    this.busValue = v;
    const i = this.map[addr >> 4];
    if (i >= 0) {
      const b = this.boards[i];
      b.write((addr - b.base) & 0xFFFF, v);
    } else if (addr < 0x8000 && this.ramEnabled) {
      this.ram[addr] = v;
    }
    if (this.watch) this.watch(addr, true);
  }

  /** read without side effects */
  peek(addr: number): number {
    const i = this.map[addr >> 4];
    if (i >= 0) {
      const b = this.boards[i];
      return b.peek((addr - b.base) & 0xFFFF);
    }
    if (addr < 0x8000) return this.ramEnabled ? this.ram[addr] : 0xFF;
    if (this.romEnabled && !this.romHole[addr >> 4]) return this.rom[addr - 0x8000];
    return 0xFF;
  }

  // ---------------- execution ----------------
  reset(): void {
    for (const b of this.boards) b.reset();
    this.irqSources.clear();
    this.nmiSources.clear();
    this.cpu.irq = false;
    this.cpu.reset();
    this.lineTarget = this.cpu.cycles;
  }

  /** RAM content at power-on: random like real SRAMs, or cleared */
  randomRam = false;

  /** power-on: initialises the RAM, then resets */
  powerOn(): void {
    if (this.randomRam) for (let i = 0; i < this.ram.length; i++) this.ram[i] = (Math.random() * 256) | 0;
    else this.ram.fill(0);
    for (const b of this.boards) b.powerOn?.();
    this.cpu.a = this.cpu.x = this.cpu.y = 0;
    this.cpu.sp = 0xFD;
    this.cpu.cycles = 0;
    this.frame = 0;
    this.reset();
  }

  /** breakpoint: if it returns true, execution stops before the instruction */
  breakpoint: ((pc: number) => boolean) | null = null;
  /** true if the last runFrame stopped on a breakpoint */
  hitBreakpoint = false;

  /** executes a single instruction (debugger step) */
  stepInstruction(): void {
    const c = this.cpu.step();
    for (const t of this.tickers) t.tick!(c);
    while (this.cpu.cycles >= this.lineTarget + this.lineCycles) this.endLine();
  }

  private line = 0;

  private endLine(): void {
    this.lineTarget += this.lineCycles;
    this.vdu?.vdp.endOfLine(this.line);
    if (++this.line >= TMS_LINES) {
      this.line = 0;
      this.frame++;
      for (const b of this.frameEnders) b.endFrame!();
    }
  }

  /** runs to the end of the current frame; false if stopped by a breakpoint */
  runFrame(): boolean {
    const cpu = this.cpu;
    const tickers = this.tickers;
    const bp = this.breakpoint;
    const startFrame = this.frame;
    this.hitBreakpoint = false;
    while (this.frame === startFrame) {
      const end = this.lineTarget + this.lineCycles;
      while (cpu.cycles < end) {
        if (bp && bp(cpu.pc)) {
          this.hitBreakpoint = true;
          return false;
        }
        const c = cpu.step();
        for (let i = 0; i < tickers.length; i++) tickers[i].tick!(c);
      }
      this.endLine();
    }
    return true;
  }
}
