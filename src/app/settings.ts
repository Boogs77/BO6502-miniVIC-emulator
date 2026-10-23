// Settings saved in the browser (localStorage, with a fallback when unavailable)

import { MachineConfig, MachineId, defaultConfig, upgradeConfig } from '../machines/profiles';
import type { KeyMode } from './Emulator';

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
