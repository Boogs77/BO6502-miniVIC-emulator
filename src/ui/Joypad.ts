// On-screen Sega Master System joystick
//
// D-pad: press and drag (diagonals too) with the mouse or a finger.
// Independent buttons 1 and 2: with multi-touch they work together with the D-pad.

import { JOY_DOWN, JOY_FIRE1, JOY_FIRE2, JOY_LEFT, JOY_RIGHT, JOY_UP } from '../boards/Boards';
import { h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export class Joypad {
  readonly el: HTMLElement;
  private dirBits = 0;
  private fireBits = 0;
  private arms = new Map<number, SVGElement>();
  private buttons = new Map<number, HTMLElement>();
  private readonly onChange: (bits: number) => void;

  constructor(player: number, onChange: (bits: number) => void) {
    this.onChange = onChange;
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

    const btn = (bit: number, label: string) => {
      const b = h('button', { class: 'joy-btn', type: 'button', 'aria-label': `Button ${label}` }, label);
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

    this.el = h('div', { class: 'joypad' },
      h('div', { class: 'joy-label' }, `JOYSTICK ${player + 1}`),
      h('div', { class: 'joy-body' },
        padWrap,
        h('div', { class: 'joy-buttons' }, btn(JOY_FIRE1, '1'), btn(JOY_FIRE2, '2')),
      ),
    );
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
