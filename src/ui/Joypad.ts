// On-screen Sega Master System joystick, or Arcade6502 control panel
//
// D-pad: press and drag (diagonals too) with the mouse or a finger.
// Independent buttons 1 and 2: with multi-touch they work together with the D-pad.
// Arcade6502 (setArcade): also button 3, START and COIN.

import { JOY_DOWN, JOY_FIRE1, JOY_FIRE2, JOY_FIRE3, JOY_LEFT, JOY_RIGHT, JOY_START, JOY_UP } from '../boards/Boards';
import { JOY_COIN } from '../app/Emulator';
import { h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** START icon: n people (head and shoulders) */
function players(n: number): SVGElement {
  const w = 12 * n + 2;
  const icon = svg('svg', { viewBox: `0 0 ${w} 14`, width: w, height: 14, class: 'start-icon', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    const x = 7 + i * 12;
    icon.append(svg('circle', { cx: x, cy: 4, r: 3 }));
    icon.append(svg('path', { d: `M${x - 5} 14 v-2 a5 5 0 0 1 10 0 v2 z` }));
  }
  return icon;
}

export class Joypad {
  readonly el: HTMLElement;
  private dirBits = 0;
  private fireBits = 0;
  private arms = new Map<number, SVGElement>();
  private buttons = new Map<number, HTMLElement>();
  private readonly onChange: (bits: number) => void;
  private readonly label: HTMLElement;
  private readonly player: number;
  /** controls present only on the Arcade6502 */
  private readonly arcadeOnly: HTMLElement[];

  constructor(player: number, onChange: (bits: number) => void) {
    this.onChange = onChange;
    this.player = player;
    const pad = svg('svg', { viewBox: '0 0 120 120', class: 'dpad', role: 'img', 'aria-label': `Player ${player + 1} D-pad` }) as SVGSVGElement;
    pad.append(svg('circle', { cx: 60, cy: 60, r: 58, class: 'dpad-base' }));
    const arm = (bit: number, d: string) => {
      const p = svg('path', { d, class: 'dpad-arm' });
      this.arms.set(bit, p);
      pad.append(p);
    };
    arm(JOY_UP, 'M44 10 h32 v36 l-16 14 l-16 -14 z');
    arm(JOY_DOWN, 'M44 110 h32 v-36 l-16 -14 l-16 14 z');
    arm(JOY_LEFT, 'M10 44 v32 h36 l14 -16 l-14 -16 z');
    arm(JOY_RIGHT, 'M110 44 v32 h-36 l-14 -16 l14 -16 z');
    pad.append(svg('circle', { cx: 60, cy: 60, r: 9, class: 'dpad-center' }));

    const padWrap = h('div', { class: 'dpad-wrap' });
    padWrap.append(pad);
    this.bindPad(pad);

    const btn = (bit: number, label: string | Node, cls = 'joy-btn', name = `Button ${label}`) => {
      const b = h('button', { class: cls, type: 'button', 'aria-label': name }, label);
      this.buttons.set(bit, b);
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.fireBits |= bit;
        this.emit();
      });
      const up = () => { this.fireBits &= ~bit; this.emit(); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      return b;
    };

    const b3 = btn(JOY_FIRE3, '3');
    // START shows one player (P1) or two players (P2), as on arcade panels; the two rows are mirrored:
    // P1 "START COIN" on the right, P2 "COIN START" on the left
    const start = btn(JOY_START, players(player + 1), 'joy-pill start', `Player ${player + 1} START`);
    const coin = btn(JOY_COIN, 'COIN', 'joy-pill coin', `Player ${player + 1} COIN`);
    const extra = h('div', { class: player === 0 ? 'joy-extra' : 'joy-extra mirror' },
      ...(player === 0 ? [start, coin] : [coin, start]));
    this.arcadeOnly = [b3, extra];
    this.label = h('div', { class: 'joy-label' });

    this.el = h('div', { class: 'joypad' },
      this.label,
      h('div', { class: 'joy-body' },
        padWrap,
        h('div', { class: 'joy-buttons' }, btn(JOY_FIRE1, '1'), btn(JOY_FIRE2, '2'), b3),
      ),
      extra,
    );
    this.setArcade(false);
  }

  /** Arcade6502 control panel (buttons 1-3, START, COIN) or SMS joystick (buttons 1-2) */
  setArcade(on: boolean): void {
    this.label.textContent = on ? `PLAYER ${this.player + 1}` : `JOYSTICK ${this.player + 1}`;
    for (const el of this.arcadeOnly) el.hidden = !on;
    this.el.classList.toggle('arcade', on);
  }

  private bindPad(pad: SVGSVGElement): void {
    let active = -1;
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      let bits = 0;
      if (Math.hypot(x, y) > 0.08) {
        const a = Math.atan2(y, x) * 180 / Math.PI; // 0 = right, 90 = down
        if (a > -67.5 && a < 67.5) bits |= JOY_RIGHT;
        if (a > 22.5 && a < 157.5) bits |= JOY_DOWN;
        if (a > 112.5 || a < -112.5) bits |= JOY_LEFT;
        if (a < -22.5 && a > -157.5) bits |= JOY_UP;
      }
      if (bits !== this.dirBits) {
        this.dirBits = bits;
        this.emit();
      }
    };
    pad.addEventListener('pointerdown', e => {
      e.preventDefault();
      active = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      move(e);
    });
    pad.addEventListener('pointermove', e => { if (e.pointerId === active) move(e); });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = -1;
      this.dirBits = 0;
      this.emit();
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
  }

  private emit(): void {
    this.onChange(this.dirBits | this.fireBits);
  }

  /** shows the actual state (mouse + keyboard + gamepad) */
  update(state: number): void {
    for (const [bit, el] of this.arms) el.classList.toggle('on', (state & bit) !== 0);
    for (const [bit, el] of this.buttons) el.classList.toggle('on', (state & bit) !== 0);
  }
}
