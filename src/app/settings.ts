// Settings saved in the browser (localStorage, with a fallback when unavailable)

import { MachineConfig, MachineId, defaultConfig, upgradeConfig } from '../machines/profiles';
import type { KeyMode } from './Emulator';
import { BiosId, ROMS } from '../machines/roms';
import { SD_KINDS, SdKind } from '../devices/SDCard';

export interface Settings {
  machine: MachineId;
  configs: Record<MachineId, MachineConfig>;
  volume: number;
  muted: boolean;
  mono: boolean;
  keyMode: KeyMode;
  showKeyboard: boolean;
  showJoysticks: boolean;
  smooth: boolean;
  scanlines: boolean;
  /** random RAM at power-on (like real SRAMs); false = cleared like minivic.js */
  randomRam: boolean;
  /** serial terminal layout: same as the CRT (40x24) or ANSI 80x24 */
  serialMode: 'crt' | 'ansi';
  /** BIOS image (public/roms, list in machines/roms.ts) */
  bios: BiosId;
  /** type of the SD card in the slot */
  sdKind: SdKind;
}

const KEY = 'bo6502-emulator.settings.v1';

function defaults(): Settings {
  return {
    machine: 'minivic',
    configs: { bo6502: defaultConfig('bo6502'), minivic: defaultConfig('minivic') },
    volume: 0.7,
    muted: false,
    mono: false,
    keyMode: 'ps2',
    showKeyboard: true,
    showJoysticks: true,
    smooth: false,
    scanlines: false,
    randomRam: false,
    serialMode: 'crt',
    bios: 'keybsd',   // the MiniVIC Apps of the default full SD need it; the games run with both
    sdKind: 'sdsc-v1',
  };
}

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = { ...d, ...JSON.parse(raw) } as Settings;
    // the miniVIC has a fixed configuration: always the factory one
    s.configs = { bo6502: upgradeConfig(s.configs?.bo6502 ?? d.configs.bo6502), minivic: defaultConfig('minivic') };
    // unknown values (old or hand-edited settings) fall back to the defaults
    if (!ROMS.some(r => r.id === s.bios)) s.bios = d.bios;
    if (!SD_KINDS.some(([k]) => k === s.sdKind)) s.sdKind = d.sdKind;
    return s;
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings only last for this session
  }
}
