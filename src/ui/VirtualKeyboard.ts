// Tastiera PS/2 virtuale (layout US, come la tabella scancode del BIOS)
//
// Con il mouse: tenere premuto un tasto = tasto premuto (codice di pressione, poi F0 + codice
// al rilascio). Shift, Ctrl e Alt restano agganciati fino al tasto successivo.

import { h } from './dom';

type KeyDef = [code: string, label: string, shifted?: string, width?: number];

const ROWS: KeyDef[][] = [
  [['Escape', 'Esc', , 1.25], ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], ['F5', 'F5'], ['F6', 'F6'],
    ['F7', 'F7'], ['F8', 'F8'], ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12']],
  [['Backquote', '`', '~'], ['Digit1', '1', '!'], ['Digit2', '2', '@'], ['Digit3', '3', '#'], ['Digit4', '4', '$'],
    ['Digit5', '5', '%'], ['Digit6', '6', '^'], ['Digit7', '7', '&'], ['Digit8', '8', '*'], ['Digit9', '9', '('],
    ['Digit0', '0', ')'], ['Minus', '-', '_'], ['Equal', '=', '+'], ['Backspace', '← Back', , 2]],
  [['Tab', 'Tab', , 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'],
    ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '[', '{'], ['BracketRight', ']', '}'],
    ['Backslash', '\\', '|', 1.5]],
  [['CapsLock', 'Caps', , 1.75], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'],
    ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';', ':'], ['Quote', "'", '"'], ['Enter', 'Enter', , 2.25]],
  [['ShiftLeft', 'Shift', , 2.25], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'],
    ['KeyM', 'M'], ['Comma', ',', '<'], ['Period', '.', '>'], ['Slash', '/', '?'], ['ShiftRight', 'Shift', , 2.75]],
  [['ControlLeft', 'Ctrl', , 1.5], ['AltLeft', 'Alt', , 1.25], ['Space', '', , 6.25], ['AltRight', 'Alt', , 1.25],
    ['ControlRight', 'Ctrl', , 1.5], ['ArrowLeft', '◀'], ['ArrowUp', '▲'], ['ArrowDown', '▼'], ['ArrowRight', '▶']],
];

const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight']);

export interface KeySink {
  keyDown(code: string): void;
  keyUp(code: string): void;
  isDown(code: string): boolean;
}

export class VirtualKeyboard {
  readonly el: HTMLElement;
  private keys = new Map<string, HTMLElement[]>();
  private latched = new Set<string>();
  private sink: KeySink | null = null;

  constructor() {
    this.el = h('div', { class: 'vkeyboard', role: 'group', 'aria-label': 'Tastiera PS/2 virtuale' });
    for (const row of ROWS) {
      const r = h('div', { class: 'vk-row' });
      for (const [code, label, shifted, width = 1] of row) {
        const k = h('button', {
          class: 'vk-key' + (MODIFIERS.has(code) ? ' mod' : '') + (code.startsWith('F') && code.length <= 3 ? ' fn' : ''),
          type: 'button', 'data-code': code, title: code,
          style: `flex-grow:${width};flex-basis:${width * 2.6}em`,
        }, shifted ? h('span', { class: 'vk-shift' }, shifted) : null, h('span', { class: 'vk-main' }, label));
        this.bind(k, code);
        r.append(k);
        const list = this.keys.get(code) ?? [];
        list.push(k);
        this.keys.set(code, list);
      }
      this.el.append(r);
    }
  }

  attach(sink: KeySink | null): void {
    this.sink = sink;
    this.latched.clear();
  }

  private bind(el: HTMLElement, code: string): void {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!this.sink) return;
      if (MODIFIERS.has(code)) {
        if (this.latched.has(code)) {
          this.latched.delete(code);
          this.sink.keyUp(code);
        } else {
          this.latched.add(code);
          this.sink.keyDown(code);
        }
        return;
      }
      el.setPointerCapture(e.pointerId);
      this.sink.keyDown(code);
    });
    const up = () => {
      if (!this.sink || MODIFIERS.has(code) || !this.sink.isDown(code)) return;
      this.sink.keyUp(code);
      for (const m of this.latched) this.sink.keyUp(m);
      this.latched.clear();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** evidenzia i tasti premuti (anche dalla tastiera fisica) */
  update(): void {
    for (const [code, els] of this.keys) {
      const down = this.sink?.isDown(code) ?? false;
      for (const k of els) {
        k.classList.toggle('down', down);
        k.classList.toggle('latched', this.latched.has(code));
      }
    }
  }
}
