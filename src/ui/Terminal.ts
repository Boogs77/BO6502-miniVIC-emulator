// Terminale seriale: 80x24 con le sequenze ANSI/VT100 usate dal BIOS
//   CR, LF, BS, TAB, FF, ESC[nJ, ESC[H / ESC[r;cH, ESC[K, ESC[nA/B/C/D, ESC[...m (ignorata)
// Si scrive cliccando sul terminale: i tasti vanno alla ricezione della W65C51.

import { h } from './dom';

const COLS = 80;
const ROWS = 24;

export class Terminal {
  readonly el: HTMLElement;
  private screen: HTMLPreElement;
  private grid: string[][] = [];
  private row = 0;
  private col = 0;
  private esc = 0;
  private params = '';
  private dirty = true;
  /** byte digitato dall'utente */
  onInput: (byte: number) => void = () => {};

  constructor() {
    this.screen = h('pre', { class: 'terminal-screen', tabindex: 0, 'aria-label': 'Terminale seriale' });
    this.el = h('div', { class: 'terminal' }, this.screen);
    this.clear();
    this.screen.addEventListener('keydown', e => this.key(e));
  }

  clear(): void {
    this.grid = Array.from({ length: ROWS }, () => new Array<string>(COLS).fill(' '));
    this.row = this.col = 0;
    this.dirty = true;
    this.render();
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

  /** byte trasmesso dalla CPU */
  write(byte: number): void {
    const c = byte & 0x7F;
    if (this.esc === 1) {
      this.esc = c === 0x5B ? 2 : 0;
      this.params = '';
      return;
    }
    if (this.esc === 2) {
      if (c >= 0x40 && c <= 0x7E) {
        this.esc = 0;
        this.csi(String.fromCharCode(c), this.params.split(';').map(p => parseInt(p, 10)));
      } else {
        this.params += String.fromCharCode(c);
      }
      return;
    }
    switch (c) {
      case 0x1B: this.esc = 1; return;
      case 0x0D: this.col = 0; break;
      case 0x0A: this.newLine(); break;
      case 0x08: if (this.col > 0) this.col--; break;
      case 0x09: this.col = Math.min(COLS - 1, (this.col + 8) & ~7); break;
      case 0x0C: this.clear(); return;
      case 0x07: break;
      default:
        if (c < 0x20) return;
        if (this.col >= COLS) { this.col = 0; this.newLine(); }
        this.grid[this.row][this.col++] = String.fromCharCode(c);
    }
    this.dirty = true;
  }

  private newLine(): void {
    if (++this.row >= ROWS) {
      this.grid.shift();
      this.grid.push(new Array<string>(COLS).fill(' '));
      this.row = ROWS - 1;
    }
  }

  private csi(cmd: string, p: number[]): void {
    const n = (i: number, d: number) => (Number.isFinite(p[i]) && p[i] > 0 ? p[i] : d);
    switch (cmd) {
      case 'J':
        if ((p[0] || 0) === 2) { for (const r of this.grid) r.fill(' '); }
        else if ((p[0] || 0) === 0) {
          this.grid[this.row].fill(' ', this.col);
          for (let r = this.row + 1; r < ROWS; r++) this.grid[r].fill(' ');
        }
        break;
      case 'H': case 'f':
        this.row = Math.min(ROWS - 1, n(0, 1) - 1);
        this.col = Math.min(COLS - 1, n(1, 1) - 1);
        break;
      case 'K': this.grid[this.row].fill(' ', (p[0] || 0) === 0 ? this.col : 0); break;
      case 'A': this.row = Math.max(0, this.row - n(0, 1)); break;
      case 'B': this.row = Math.min(ROWS - 1, this.row + n(0, 1)); break;
      case 'C': this.col = Math.min(COLS - 1, this.col + n(0, 1)); break;
      case 'D': this.col = Math.max(0, this.col - n(0, 1)); break;
    }
    this.dirty = true;
  }

  /** aggiorna il testo (chiamata una volta per frame) */
  render(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const lines = this.grid.map((r, i) => {
      if (i !== this.row) return r.join('');
      const s = r.slice();
      s[Math.min(this.col, COLS - 1)] = '█';
      return s.join('');
    });
    this.screen.textContent = lines.join('\n');
  }

  focus(): void {
    this.screen.focus();
  }
}
