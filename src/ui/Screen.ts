// Schermo del VDU: converte gli indici di colore del TMS9918A in pixel sul canvas

import { SCREEN_H, SCREEN_W, TMS_PALETTE } from '../devices/TMS9918A';
import { Machine } from '../core/Machine';
import { h } from './dom';

export class Screen {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private palette32 = new Uint32Array(16);
  private noSignal: HTMLElement;

  constructor() {
    this.canvas = h('canvas', { width: SCREEN_W, height: SCREEN_H, class: 'screen-canvas', tabindex: 0, 'aria-label': 'Schermo del VDU' });
    this.noSignal = h('div', { class: 'no-signal' }, 'NESSUN SEGNALE');
    this.el = h('div', { class: 'screen-wrap' }, this.canvas, this.noSignal);
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    TMS_PALETTE.forEach(([r, g, b], i) => {
      this.palette32[i] = little ? (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xFF) >>> 0;
    });
    this.clear();
  }

  setSmooth(smooth: boolean): void {
    this.canvas.classList.toggle('smooth', smooth);
  }

  setScanlines(on: boolean): void {
    this.el.classList.toggle('scanlines', on);
  }

  clear(): void {
    this.ctx.fillStyle = '#05070a';
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  draw(m: Machine | null, powered: boolean): void {
    const vdu = m?.vdu;
    this.noSignal.hidden = powered && !!vdu;
    if (!powered || !vdu) {
      this.clear();
      return;
    }
    const src = vdu.vdp.frame;
    const dst = new Uint32Array(this.image.data.buffer);
    const pal = this.palette32;
    for (let i = 0; i < src.length; i++) dst[i] = pal[src[i]];
    this.ctx.putImageData(this.image, 0, 0);
  }
}
