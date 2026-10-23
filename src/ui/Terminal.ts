// Terminale seriale: vista del TerminalModel (impaginazione 'crt' come il VDU, oppure 'ansi' 80x24).
// Si scrive cliccando sul terminale: i tasti vanno alla ricezione della W65C51.

import { h } from './dom';
import { TerminalModel, TerminalMode } from './TerminalModel';

export type { TerminalMode };

export class Terminal {
  readonly el: HTMLElement;
  readonly model = new TerminalModel();
  private screen: HTMLPreElement;
  /** byte digitato dall'utente */
  onInput: (byte: number) => void = () => {};

  constructor() {
    this.screen = h('pre', { class: 'terminal-screen', tabindex: 0, 'aria-label': 'Terminale seriale' });
    this.el = h('div', { class: 'terminal crt' }, this.screen);
    this.screen.addEventListener('keydown', e => this.key(e));
    this.render();
  }

  setMode(mode: TerminalMode): void {
    this.model.setMode(mode);
    this.el.classList.toggle('crt', mode === 'crt');
    this.render();
  }

  clear(): void {
    this.model.clear();
    this.render();
  }

  write(byte: number): void {
    this.model.write(byte);
  }

  private key(e: KeyboardEvent): void {
    let b = -1;
    if (e.key.length === 1 && !e.ctrlKey) b = e.key.charCodeAt(0);
    else if (e.key === 'Enter') b = 0x0D;
    else if (e.key === 'Backspace') b = 0x08;
    else if (e.key === 'Escape') b = 0x1B;
    else if (e.key === 'Tab') b = 0x09;
    else if (e.ctrlKey && e.key.length === 1) b = e.key.toUpperCase().charCodeAt(0) & 0x1F;
    if (b >= 0 && b < 0x80) {
      this.onInput(b);
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** aggiorna il testo (chiamata una volta per frame) */
  render(): void {
    if (!this.model.dirty) return;
    this.model.dirty = false;
    this.screen.textContent = this.model.lines().join('\n');
  }

  focus(): void {
    this.screen.focus();
  }
}
