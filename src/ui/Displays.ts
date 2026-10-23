// Displays of the output boards: Big LCD T6963, LCD 16x2 HD44780, 16 LEDs

import { Machine } from '../core/Machine';
import { BigLcdBoard, LcdBoard, LedBoard } from '../boards/DisplayBoards';
import { T6963_H, T6963_W } from '../devices/T6963';
import { glyph } from '../devices/font5x8';
import { h } from './dom';

// DS-G160128STBWW: blue STN, white backlight
const BIG_ON = [236, 244, 255];
const BIG_OFF = [30, 52, 196];

class BigLcdView {
  readonly el: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private pixels = new Uint8Array(T6963_W * T6963_H);

  constructor() {
    const canvas = h('canvas', { width: T6963_W, height: T6963_H, class: 'biglcd-canvas', 'aria-label': 'Big LCD 160x128' });
    this.ctx = canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(T6963_W, T6963_H);
    this.el = h('div', { class: 'display-card' }, h('div', { class: 'display-title' }, 'Big LCD T6963 · 160x128'), h('div', { class: 'biglcd-bezel' }, canvas));
  }

  draw(b: BigLcdBoard, frame: number, powered: boolean): void {
    const d = this.img.data;
    if (powered) b.lcd.render(this.pixels, (frame >> 4) & 1 ? true : false);
    else this.pixels.fill(0);
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] ? BIG_ON : BIG_OFF;
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// LCD 16x2: 5x8 dot cells with gaps, like the real display
const DOT = 3, GAP = 1, CELL_W = 5 * (DOT + GAP) + 2, CELL_H = 8 * (DOT + GAP) + 3;
const LCD_W = 16 * CELL_W + 8, LCD_H = 2 * CELL_H + 8;

class CharLcdView {
  readonly el: HTMLElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    const canvas = h('canvas', { width: LCD_W, height: LCD_H, class: 'lcd16-canvas', 'aria-label': 'LCD 16x2' });
    this.ctx = canvas.getContext('2d')!;
    this.el = h('div', { class: 'display-card' }, h('div', { class: 'display-title' }, 'LCD HD44780 · 16x2'), h('div', { class: 'lcd16-bezel' }, canvas));
  }

  draw(b: LcdBoard, frame: number, powered: boolean): void {
    const ctx = this.ctx;
    const lcd = b.lcd;
    ctx.fillStyle = '#9bbd24';
    ctx.fillRect(0, 0, LCD_W, LCD_H);
    const on = powered && lcd.displayOn;
    const cur = on ? lcd.cursorCell() : null;
    const blink = (frame >> 5) & 1;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 16; c++) {
        const code = lcd.charAt(r, c);
        const rows = code < 16 ? lcd.cgram.subarray((code & 7) * 8, (code & 7) * 8 + 8) : null;
        const g = rows ? null : glyph(code);
        const isCur = cur !== null && cur[0] === r && cur[1] === c;
        const x0 = 4 + c * CELL_W, y0 = 4 + r * CELL_H;
        for (let y = 0; y < 8; y++) {
          let bits = on ? (rows ? (rows[y] & 0x1F) << 3 : g![y]) : 0;
          if (isCur && lcd.blinkOn && blink) bits = 0xF8;
          if (isCur && lcd.cursorOn && y === 7) bits = 0xF8;
          for (let x = 0; x < 5; x++) {
            ctx.fillStyle = bits & (0x80 >> x) ? '#1f2a0a' : 'rgba(40, 60, 0, 0.12)';
            ctx.fillRect(x0 + x * (DOT + GAP), y0 + y * (DOT + GAP), DOT, DOT);
          }
        }
      }
    }
  }
}

class LedView {
  readonly el: HTMLElement;
  private leds: HTMLElement[] = [];

  constructor() {
    const bank = (name: string, offset: number) => {
      const row = h('div', { class: 'led-bank' }, h('span', { class: 'led-name' }, name));
      for (let i = 7; i >= 0; i--) {
        const l = h('span', { class: 'led', title: `${name}${i}` });
        this.leds[offset + i] = l;
        row.append(l);
      }
      return row;
    };
    this.el = h('div', { class: 'display-card' }, h('div', { class: 'display-title' }, 'LED test · W65C22'), bank('PA', 0), bank('PB', 8));
  }

  draw(b: LedBoard, powered: boolean): void {
    const v = powered ? b.leds : 0;
    this.leds.forEach((l, i) => l.classList.toggle('on', ((v >> i) & 1) === 1));
  }
}

export class Displays {
  readonly el = h('div', { class: 'displays' });
  private big = new BigLcdView();
  private lcd = new CharLcdView();
  private leds = new LedView();

  /** shows only the displays of the plugged-in boards */
  bind(m: Machine): void {
    const parts: HTMLElement[] = [];
    if (m.board('biglcd')) parts.push(this.big.el);
    if (m.board('lcd')) parts.push(this.lcd.el);
    if (m.board('leds')) parts.push(this.leds.el);
    this.el.replaceChildren(...parts);
    this.el.hidden = parts.length === 0;
  }

  draw(m: Machine, powered: boolean): void {
    const big = m.board<BigLcdBoard>('biglcd');
    const lcd = m.board<LcdBoard>('lcd');
    const leds = m.board<LedBoard>('leds');
    if (big) this.big.draw(big, m.frame, powered);
    if (lcd) this.lcd.draw(lcd, m.frame, powered);
    if (leds) this.leds.draw(leds, powered);
  }
}
