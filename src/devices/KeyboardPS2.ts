// PS/2 keyboard (AT, DIN 5) of the KEYb board
//
// On the real board two 74HCT595s turn the keyboard serial stream into a byte on the
// VIA port A and KB_INT goes to CA1: the CPU receives the raw set 2 scancodes
// (make code, F0 + code on release, E0 prefix for the extended keys).
// A PS/2 byte takes about 1 ms: queued bytes are presented one at a time, the next one
// when the CPU has read the previous one (or anyway after a maximum time, as on the
// real circuit, where an unread byte is overwritten).

import { VIA6522 } from './VIA6522';

/** KeyboardEvent.code -> scancode set 2 (0x100 = E0 prefix) */
export const PS2_SET2: Record<string, number> = {
  Escape: 0x76, F1: 0x05, F2: 0x06, F3: 0x04, F4: 0x0C, F5: 0x03, F6: 0x0B, F7: 0x83,
  F8: 0x0A, F9: 0x01, F10: 0x09, F11: 0x78, F12: 0x07,
  Backquote: 0x0E, Digit1: 0x16, Digit2: 0x1E, Digit3: 0x26, Digit4: 0x25, Digit5: 0x2E,
  Digit6: 0x36, Digit7: 0x3D, Digit8: 0x3E, Digit9: 0x46, Digit0: 0x45, Minus: 0x4E,
  Equal: 0x55, Backspace: 0x66,
  Tab: 0x0D, KeyQ: 0x15, KeyW: 0x1D, KeyE: 0x24, KeyR: 0x2D, KeyT: 0x2C, KeyY: 0x35,
  KeyU: 0x3C, KeyI: 0x43, KeyO: 0x44, KeyP: 0x4D, BracketLeft: 0x54, BracketRight: 0x5B,
  Backslash: 0x5D,
  CapsLock: 0x58, KeyA: 0x1C, KeyS: 0x1B, KeyD: 0x23, KeyF: 0x2B, KeyG: 0x34, KeyH: 0x33,
  KeyJ: 0x3B, KeyK: 0x42, KeyL: 0x4B, Semicolon: 0x4C, Quote: 0x52, Enter: 0x5A,
  ShiftLeft: 0x12, IntlBackslash: 0x61, KeyZ: 0x1A, KeyX: 0x22, KeyC: 0x21, KeyV: 0x2A,
  KeyB: 0x32, KeyN: 0x31, KeyM: 0x3A, Comma: 0x41, Period: 0x49, Slash: 0x4A, ShiftRight: 0x59,
  ControlLeft: 0x14, AltLeft: 0x11, Space: 0x29, AltRight: 0x111, ControlRight: 0x114,
  MetaLeft: 0x11F, MetaRight: 0x127, ContextMenu: 0x12F,
  Insert: 0x170, Home: 0x16C, PageUp: 0x17D, Delete: 0x171, End: 0x169, PageDown: 0x17A,
  ArrowUp: 0x175, ArrowLeft: 0x16B, ArrowDown: 0x172, ArrowRight: 0x174,
  NumLock: 0x77, NumpadDivide: 0x14A, NumpadMultiply: 0x7C, NumpadSubtract: 0x7B,
  NumpadAdd: 0x79, NumpadEnter: 0x15A, NumpadDecimal: 0x71,
  Numpad0: 0x70, Numpad1: 0x69, Numpad2: 0x72, Numpad3: 0x7A, Numpad4: 0x6B,
  Numpad5: 0x73, Numpad6: 0x74, Numpad7: 0x6C, Numpad8: 0x75, Numpad9: 0x7D,
  ScrollLock: 0x7E,
};

const BYTE_CYCLES = 1100;       // ~1.1 ms at 1 MHz for one PS/2 byte
const MAX_WAIT_CYCLES = 30000;  // after ~30 ms the next byte overwrites it anyway

export class KeyboardPS2 {
  private queue: number[] = [];
  private wait = 0;
  private presented = false;
  private readonly via: VIA6522;
  /** pressed keys (so the make code is not repeated) */
  private readonly down = new Set<string>();

  constructor(via: VIA6522) {
    this.via = via;
  }

  reset(): void {
    this.queue = [];
    this.down.clear();
    this.presented = false;
    this.wait = 0;
  }

  /** key press (repeat = browser auto-repeat) */
  keyDown(code: string, repeat = false): boolean {
    const sc = PS2_SET2[code];
    if (sc === undefined) return false;
    if (this.down.has(code) && !repeat) return true;
    this.down.add(code);
    if (code === 'Pause') return true;
    if (sc & 0x100) this.queue.push(0xE0);
    this.queue.push(sc & 0xFF);
    return true;
  }

  keyUp(code: string): boolean {
    const sc = PS2_SET2[code];
    if (sc === undefined) return false;
    if (!this.down.delete(code)) return true;
    if (sc & 0x100) this.queue.push(0xE0);
    this.queue.push(0xF0, sc & 0xFF);
    return true;
  }

  releaseAll(): void {
    for (const code of [...this.down]) this.keyUp(code);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** advances by n CPU cycles: presents the next byte on port A */
  tick(n: number): void {
    if (this.wait > 0) this.wait -= n;
    if (this.presented) {
      // the byte was read when the CPU cleared the CA1 flag
      const read = (this.via.ifr & 0x02) === 0;
      if (!read && this.wait > -MAX_WAIT_CYCLES) return;
      this.presented = false;
    }
    if (this.wait > 0 || this.queue.length === 0) return;
    this.via.inputA = this.queue.shift()!;
    this.via.pulseCA1();
    this.presented = true;
    this.wait = BYTE_CYCLES;
  }
}
