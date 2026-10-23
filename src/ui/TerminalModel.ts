// Terminale seriale
//
// Due impaginazioni:
//  'crt'  come il driver CRT del BIOS (print_crt_ch in crt_text_drv.s), cosi' la seriale mostra
//         la stessa pagina del VDU: 40x24, LF = a capo, CR ignorato, a capo automatico a 40
//         colonne, dopo la riga 24 si riparte dalla riga 0 con lo schermo pulito (niente
//         scorrimento), ESC (con la sua sequenza ANSI) = pulisci e torna in alto
//  'ansi' terminale VT100 80x24: CR, LF, BS, TAB, FF, ESC[nJ, ESC[H / ESC[r;cH, ESC[K,
//         ESC[nA/B/C/D, ESC[...m (ignorata), con scorrimento
// Questo e' il modello (senza DOM); la vista e' in Terminal.ts.

export type TerminalMode = 'crt' | 'ansi';

const ROWS = 24;

export class TerminalModel {
  private grid: string[][] = [];
  private row = 0;
  private col = 0;
  private esc = 0;
  private params = '';
  private mode: TerminalMode = 'crt';
  /** true se il contenuto e' cambiato dall'ultimo render */
  dirty = true;

  constructor() {
    this.clear();
  }

  get cols(): number {
    return this.mode === 'crt' ? 40 : 80;
  }

  get currentMode(): TerminalMode {
    return this.mode;
  }

  setMode(mode: TerminalMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.clear();
  }

  clear(): void {
    this.grid = Array.from({ length: ROWS }, () => new Array<string>(this.cols).fill(' '));
    this.row = this.col = 0;
    this.dirty = true;
  }

  /** byte trasmesso dalla CPU */
  write(byte: number): void {
    const c = byte & 0x7F;
    if (this.esc === 1) {
      this.esc = c === 0x5B ? 2 : 0;
      this.params = '';
      if (this.esc === 0 && this.mode === 'crt') this.crtClear();
      return;
    }
    if (this.esc === 2) {
      if (c >= 0x40 && c <= 0x7E) {
        this.esc = 0;
        if (this.mode === 'crt') this.crtClear();
        else this.csi(String.fromCharCode(c), this.params.split(';').map(p => parseInt(p, 10)));
      } else {
        this.params += String.fromCharCode(c);
      }
      return;
    }
    if (c === 0x1B) {
      this.esc = 1;
      return;
    }
    if (this.mode === 'crt') this.crtChar(c);
    else this.ansiChar(c);
    this.dirty = true;
  }

  // ---------------- impaginazione del CRT ----------------
  private crtClear(): void {
    for (const r of this.grid) r.fill(' ');
    this.row = this.col = 0;
    this.dirty = true;
  }

  private crtNewLine(): void {
    this.col = 0;
    if (++this.row >= ROWS) this.crtClear(); // niente scorrimento: si riparte dalla riga 0
  }

  private crtChar(c: number): void {
    if (c === 0x0A) { this.crtNewLine(); return; }
    if (c === 0x0D) return;
    // gli altri codici di controllo il CRT li stampa come caratteri grafici: qui uno spazio
    this.grid[this.row][this.col] = c >= 0x20 ? String.fromCharCode(c) : ' ';
    if (++this.col >= 40) this.crtNewLine();
  }

  // ---------------- terminale ANSI ----------------
  private ansiChar(c: number): void {
    const cols = this.cols;
    switch (c) {
      case 0x0D: this.col = 0; break;
      case 0x0A: this.ansiNewLine(); break;
      case 0x08: if (this.col > 0) this.col--; break;
      case 0x09: this.col = Math.min(cols - 1, (this.col + 8) & ~7); break;
      case 0x0C: this.clear(); break;
      case 0x07: break;
      default:
        if (c < 0x20) return;
        if (this.col >= cols) { this.col = 0; this.ansiNewLine(); }
        this.grid[this.row][this.col++] = String.fromCharCode(c);
    }
  }

  private ansiNewLine(): void {
    if (++this.row >= ROWS) {
      this.grid.shift();
      this.grid.push(new Array<string>(this.cols).fill(' '));
      this.row = ROWS - 1;
    }
  }

  private csi(cmd: string, p: number[]): void {
    const cols = this.cols;
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
        this.col = Math.min(cols - 1, n(1, 1) - 1);
        break;
      case 'K': this.grid[this.row].fill(' ', (p[0] || 0) === 0 ? this.col : 0); break;
      case 'A': this.row = Math.max(0, this.row - n(0, 1)); break;
      case 'B': this.row = Math.min(ROWS - 1, this.row + n(0, 1)); break;
      case 'C': this.col = Math.min(cols - 1, this.col + n(0, 1)); break;
      case 'D': this.col = Math.max(0, this.col - n(0, 1)); break;
    }
    this.dirty = true;
  }

  /** righe da mostrare, con il cursore */
  lines(): string[] {
    const cols = this.cols;
    return this.grid.map((r, i) => {
      if (i !== this.row) return r.join('');
      const s = r.slice();
      s[Math.min(this.col, cols - 1)] = '█';
      return s.join('');
    });
  }

  /** testo dello schermo (per i test) */
  text(): string {
    return this.grid.map(r => r.join('').trimEnd()).join('\n');
  }
}
