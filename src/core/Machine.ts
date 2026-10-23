// Machine - CPU, memoria, bus e schede di una macchina BO6502 / miniVIC
//
// Bus: la decodifica e' a blocchi di 16 byte. Ogni blocco punta a una scheda oppure
// alla RAM ($0000-$7FFF) o alla ROM ($8000-$FFFF). Nei "buchi" della ROM (le zone di I/O
// disattivate con i jumper J-CS della ROM multi) senza scheda si legge il bus aperto.
// Tempo: un frame NTSC = 262 righe; alla fine di ogni riga il VDP disegna la riga.

import { W65C02 } from '../cpu/W65C02';
import { Board, BoardContext } from './Board';
import { StereoSink } from '../audio/StereoSink';
import { TMS_LINES } from '../devices/TMS9918A';
import { VduBoard } from '../boards/Boards';

export const NTSC_FPS = 59.922743;

export interface MachineOptions {
  cpuHz: number;
  /** zone senza ROM ([inizio, fine] inclusi) */
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

  /** numero di frame eseguiti */
  frame = 0;
  /** ultimo valore sul bus dati (per il bus aperto) */
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

  /** chiamata quando la CPU legge/scrive (solo se impostata: per i breakpoint) */
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

  // ---------------- configurazione ----------------
  addBoard(board: Board): void {
    this.boards.push(board);
    board.attach(this.ctx);
    this.rebuildMap();
  }

  /** ricostruisce la mappa del bus (dopo un cambio di indirizzo) */
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

  /** prima scheda di un tipo */
  board<T extends Board>(type: Board['type']): T | undefined {
    return this.boards.find(b => b.type === type) as T | undefined;
  }

  get vdu(): VduBoard | undefined {
    return this.board<VduBoard>('vdu');
  }

  /** scheda che decodifica un indirizzo (per il debugger) */
  boardAt(addr: number): Board | undefined {
    const i = this.map[addr >> 4];
    return i >= 0 ? this.boards[i] : undefined;
  }

  loadRom(data: Uint8Array): void {
    this.rom.fill(0xFF);
    // un'immagine piu' corta di 32 KB si allinea alla fine (i vettori stanno a $FFFA)
    const d = data.length > 0x8000 ? data.subarray(data.length - 0x8000) : data;
    this.rom.set(d, 0x8000 - d.length);
  }

  /** scrive dati direttamente in memoria (RAM, o ROM se l'indirizzo e' >= $8000) */
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
      // NMI e' sensibile al fronte: scatta quando la linea (wired-OR) diventa attiva
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
      v = addr >> 8; // bus aperto: resta l'ultimo byte letto (di solito l'alto dell'indirizzo)
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

  /** lettura senza effetti collaterali */
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

  // ---------------- esecuzione ----------------
  reset(): void {
    for (const b of this.boards) b.reset();
    this.irqSources.clear();
    this.nmiSources.clear();
    this.cpu.irq = false;
    this.cpu.reset();
    this.lineTarget = this.cpu.cycles;
  }

  /** contenuto della RAM all'accensione: casuale come le SRAM reali, oppure azzerata */
  randomRam = false;

  /** accensione: inizializza la RAM, poi reset */
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

  /** breakpoint: se restituisce true, l'esecuzione si ferma prima dell'istruzione */
  breakpoint: ((pc: number) => boolean) | null = null;
  /** true se l'ultimo runFrame si e' fermato su un breakpoint */
  hitBreakpoint = false;

  /** esegue una singola istruzione (passo del debugger) */
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

  /** esegue fino alla fine del frame corrente; false se fermato da un breakpoint */
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
