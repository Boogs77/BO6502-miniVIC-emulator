// Profili delle macchine emulate
//
// BO6502: computer modulare, ogni scheda si inserisce o si toglie dal rack e il suo
//         indirizzo si puo' cambiare (come i jumper reali). Il VDP interrompe su IRQ.
// miniVIC: stessa architettura in formato compatto, configurazione fissa.
//          Audio a $D38x, joystick a $D58x, SD a $DD8x, VDP su NMI.

import { Machine } from '../core/Machine';
import { BoardType, IrqLine } from '../core/Board';
import {
  AudioBoard, JoystickBoard, KeyboardBoard, SdCardBoard, SerialBoard, VduBoard,
} from '../boards/Boards';

export type MachineId = 'bo6502' | 'minivic';

export interface BoardConfig {
  type: BoardType;
  enabled: boolean;
  base: number;
  irq: IrqLine;
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
  /** passo con cui si puo' spostare l'indirizzo */
  step: number;
  /** la scheda ha una linea di interrupt configurabile */
  hasIrq: boolean;
}

export const BOARD_INFO: Record<BoardType, BoardInfo> = {
  vdu: { type: 'vdu', name: 'VDU', chips: 'TMS9918A + 32KB VRAM', step: 0x1000, hasIrq: true },
  serial: { type: 'serial', name: 'Serial I/O', chips: 'W65C51 ACIA + MAX232', step: 0x1000, hasIrq: true },
  keyboard: { type: 'keyboard', name: 'KEYb', chips: 'W65C22 + 2x 74HCT595 (PS/2)', step: 0x10, hasIrq: true },
  joystick: { type: 'joystick', name: 'Joystick', chips: 'W65C22 + 2x DB9 Sega', step: 0x10, hasIrq: true },
  sdcard: { type: 'sdcard', name: 'SD Card', chips: 'W65C22 SPI bit-bang', step: 0x10, hasIrq: true },
  audio: { type: 'audio', name: 'Audio', chips: '2x AY-3-8910 + 2x LM386 (stereo)', step: 0x10, hasIrq: false },
};

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
      { type: 'joystick', enabled: true, base: 0xD1A0, irq: 'irq' },
      { type: 'sdcard', enabled: true, base: 0xD1B0, irq: 'irq' },
      { type: 'audio', enabled: true, base: 0xD1C0, irq: 'none' },
    ],
  };
}

/** il miniVIC ha la configurazione fissa */
export function isConfigurable(id: MachineId): boolean {
  return id === 'bo6502';
}

/** clock selezionabili sulla scheda RESET del BO6502 */
export const BO6502_CLOCKS = [500_000, 1_000_000, 2_000_000];

export function buildMachine(cfg: MachineConfig): Machine {
  const m = new Machine({
    cpuHz: cfg.cpuHz,
    // ROM multi con J-CS3/4/5 su VCC: niente ROM nelle pagine di I/O $B000-$DFFF
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
    }
  }
  return m;
}
