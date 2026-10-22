// Impostazioni salvate nel browser (localStorage, con fallback se non disponibile)

import { MachineConfig, MachineId, defaultConfig } from '../machines/profiles';
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
  };
}

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = { ...d, ...JSON.parse(raw) } as Settings;
    // il miniVIC ha la configurazione fissa: sempre quella di fabbrica
    s.configs = { bo6502: s.configs?.bo6502 ?? d.configs.bo6502, minivic: defaultConfig('minivic') };
    return s;
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // archiviazione non disponibile: le impostazioni valgono solo per questa sessione
  }
}
