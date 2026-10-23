// Profiles of the emulated machines
//
// BO6502: modular computer, every board can be plugged into or removed from the rack and
//         its address can be changed (like the real jumpers). The VDP interrupts on IRQ.
// miniVIC: same architecture in a compact form, fixed configuration.
//          Audio at $D38x, joystick at $D58x, SD at $DD8x, VDP on NMI.

import { Machine } from '../core/Machine';
import { BoardType, IrqLine } from '../core/Board';
import {
  AudioBoard, JoystickBoard, KeyboardBoard, SdCardBoard, SerialBoard, VduBoard,
} from '../boards/Boards';
import { BigLcdBoard, LcdBoard, LcdWiring, LedBoard } from '../boards/DisplayBoards';

export type MachineId = 'bo6502' | 'minivic';

export interface BoardConfig {
  type: BoardType;
  enabled: boolean;
  base: number;
  irq: IrqLine;
  /** board-specific option (LCD: '4bit' / '8bit' wiring) */
  option?: string;
}

export interface MachineConfig {
  id: MachineId;
  cpuHz: number;
  ram: boolean;
  rom: boolean;
  boards: BoardConfig[];
}

export interface BoardInfo {
  type: BoardType;
  name: string;
  chips: string;
  /** step by which the address can be moved */
  step: number;
  /** size of the decoded space */
  size: number;
  /** the board has a configurable interrupt line */
  hasIrq: boolean;
}

export const BOARD_INFO: Record<BoardType, BoardInfo> = {
  vdu: { type: 'vdu', name: 'VDU', chips: 'TMS9918A + 32KB VRAM', step: 0x1000, size: 0x1000, hasIrq: true },
  serial: { type: 'serial', name: 'Serial I/O', chips: 'W65C51 ACIA + MAX232', step: 0x1000, size: 0x1000, hasIrq: true },
  keyboard: { type: 'keyboard', name: 'KEYb', chips: 'W65C22 + 2x 74HCT595 (PS/2)', step: 0x10, size: 0x10, hasIrq: true },
  joystick: { type: 'joystick', name: 'Joystick', chips: 'W65C22 + 2x DB9 Sega', step: 0x10, size: 0x10, hasIrq: true },
  sdcard: { type: 'sdcard', name: 'SD Card', chips: 'W65C22 SPI bit-bang', step: 0x10, size: 0x10, hasIrq: true },
  audio: { type: 'audio', name: 'Audio', chips: '2x AY-3-8910 + 2x LM386 (stereo)', step: 0x10, size: 0x10, hasIrq: false },
  biglcd: { type: 'biglcd', name: 'Big LCD', chips: 'W65C22 + T6963C, DS-G160128 160x128', step: 0x10, size: 0x10, hasIrq: true },
  lcd: { type: 'lcd', name: 'LCD legacy', chips: 'W65C22 + HD44780U 16x2 (decodes $Dxxx)', step: 0x1000, size: 0x1000, hasIrq: true },
  leds: { type: 'leds', name: 'LED test', chips: 'W65C22 + 16 LEDs (decodes $Dxxx)', step: 0x1000, size: 0x1000, hasIrq: true },
};

/** boards in the BO6502 rack (also unplugged ones), in bus priority order */
export const BO6502_BOARD_ORDER: BoardType[] = ['vdu', 'serial', 'keyboard', 'biglcd', 'joystick', 'sdcard', 'audio', 'lcd', 'leds'];

export const MACHINE_NAMES: Record<MachineId, string> = {
  bo6502: 'BO6502',
  minivic: 'miniVIC',
};

export function defaultConfig(id: MachineId): MachineConfig {
  if (id === 'minivic') {
    return {
      id, cpuHz: 1_000_000, ram: true, rom: true,
      boards: [
        { type: 'vdu', enabled: true, base: 0xB000, irq: 'nmi' },
        { type: 'serial', enabled: true, base: 0xC000, irq: 'irq' },
        { type: 'keyboard', enabled: true, base: 0xD180, irq: 'irq' },
        { type: 'audio', enabled: true, base: 0xD380, irq: 'none' },
        { type: 'joystick', enabled: true, base: 0xD580, irq: 'irq' },
        { type: 'sdcard', enabled: true, base: 0xDD80, irq: 'irq' },
      ],
    };
  }
  return {
    id, cpuHz: 1_000_000, ram: true, rom: true,
    boards: [
      { type: 'vdu', enabled: true, base: 0xB000, irq: 'irq' },
      { type: 'serial', enabled: true, base: 0xC000, irq: 'irq' },
      { type: 'keyboard', enabled: true, base: 0xD180, irq: 'irq' },
      { type: 'biglcd', enabled: true, base: 0xD190, irq: 'irq' },
      { type: 'joystick', enabled: true, base: 0xD1A0, irq: 'irq' },
      { type: 'sdcard', enabled: true, base: 0xD1B0, irq: 'irq' },
      { type: 'audio', enabled: true, base: 0xD1C0, irq: 'none' },
      // they decode the whole $Dxxx page: off, otherwise they shadow the other boards
      { type: 'lcd', enabled: false, base: 0xD000, irq: 'irq', option: '4bit' },
      { type: 'leds', enabled: false, base: 0xD000, irq: 'irq' },
    ],
  };
}

/** adds the boards introduced later to a saved configuration */
export function upgradeConfig(cfg: MachineConfig): MachineConfig {
  if (cfg.id !== 'bo6502') return cfg;
  const def = defaultConfig('bo6502');
  const boards = BO6502_BOARD_ORDER
    .map(t => cfg.boards.find(b => b.type === t) ?? def.boards.find(b => b.type === t)!)
    .map(b => ({ ...b }));
  return { ...cfg, boards };
}

/** the miniVIC has a fixed configuration */
export function isConfigurable(id: MachineId): boolean {
  return id === 'bo6502';
}

/** clocks selectable on the BO6502 RESET board */
export const BO6502_CLOCKS = [500_000, 1_000_000, 2_000_000];

export function buildMachine(cfg: MachineConfig): Machine {
  const m = new Machine({
    cpuHz: cfg.cpuHz,
    // multi ROM with J-CS3/4/5 on VCC: no ROM in the I/O pages $B000-$DFFF
    romHoles: [[0xB000, 0xDFFF]],
  });
  m.ramEnabled = cfg.ram;
  m.romEnabled = cfg.rom;
  for (const b of cfg.boards) {
    if (!b.enabled) continue;
    switch (b.type) {
      case 'vdu': m.addBoard(new VduBoard(b.base, b.irq)); break;
      case 'serial': { const s = new SerialBoard(b.base); s.irqLine = b.irq; m.addBoard(s); break; }
      case 'keyboard': { const k = new KeyboardBoard(b.base); k.irqLine = b.irq; m.addBoard(k); break; }
      case 'joystick': { const j = new JoystickBoard(b.base); j.irqLine = b.irq; m.addBoard(j); break; }
      case 'sdcard': { const s = new SdCardBoard(b.base); s.irqLine = b.irq; m.addBoard(s); break; }
      case 'audio': m.addBoard(new AudioBoard(b.base)); break;
      case 'biglcd': { const l = new BigLcdBoard(b.base); l.irqLine = b.irq; m.addBoard(l); break; }
      case 'lcd': { const l = new LcdBoard(b.base, (b.option as LcdWiring) || '4bit'); l.irqLine = b.irq; m.addBoard(l); break; }
      case 'leds': { const l = new LedBoard(b.base); l.irqLine = b.irq; m.addBoard(l); break; }
    }
  }
  return m;
}
