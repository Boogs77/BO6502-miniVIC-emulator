// Audio: volume, stereo/mono, VU meter L/R e stato dei due AY-3-8910 con mute per canale

import { Emulator } from '../../app/Emulator';
import { AY38910 } from '../../devices/AY38910';
import { AudioBoard } from '../../boards/Boards';
import { h, hex } from '../dom';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteName(freq: number): string {
  if (freq < 16 || freq > 20000) return '';
  const n = Math.round(12 * Math.log2(freq / 440)) + 57;
  return NOTE_NAMES[((n % 12) + 12) % 12] + Math.floor(n / 12);
}

/** vista di un chip: elementi creati una volta, aggiornati a ogni refresh */
class ChipView {
  readonly el: HTMLElement;
  private title = h('span', { class: 'dim' });
  private levels: HTMLElement[] = [];
  private infos: HTMLElement[] = [];
  private buttons: HTMLElement[] = [];
  private extra = h('div', { class: 'ay-extra' });
  private regs: HTMLElement[] = [];
  private getChip: () => AY38910 | undefined;

  constructor(name: string, getChip: () => AY38910 | undefined) {
    this.getChip = getChip;
    const rows: HTMLElement[] = [];
    for (let ch = 0; ch < 3; ch++) {
      const level = h('i', {});
      const info = h('span', { class: 'ay-info' });
      const btn = h('button', {
        type: 'button', class: 'ay-ch',
        onclick: () => { const ay = this.getChip(); if (ay) ay.muted[ch] = !ay.muted[ch]; this.update(1e6); },
      }, h('b', {}, 'ABC'[ch]), h('span', { class: 'ay-level' }, level), info);
      this.levels.push(level);
      this.infos.push(info);
      this.buttons.push(btn);
      rows.push(btn);
    }
    const regRow = h('div', { class: 'ay-regs' });
    for (let i = 0; i < 16; i++) {
      const s = h('span', { title: `R${i}` });
      this.regs.push(s);
      regRow.append(s);
    }
    this.el = h('div', { class: 'ay-chip' }, h('div', { class: 'ay-title' }, name, ' ', this.title), ...rows, this.extra, regRow);
  }

  setPort(port: number): void {
    this.title.textContent = `latch $${hex(port, 4)} · dato $${hex(port + 1, 4)}`;
  }

  update(hz: number): void {
    const ay = this.getChip();
    if (!ay) return;
    const r = ay.regs;
    for (let ch = 0; ch < 3; ch++) {
      const tp = r[ch * 2] | (r[ch * 2 + 1] << 8);
      const tone = !(r[7] & (1 << ch));
      const noise = !(r[7] & (8 << ch));
      const env = (r[8 + ch] & 0x10) !== 0;
      const vol = r[8 + ch] & 0x0F;
      const freq = tp ? hz / (16 * tp) : 0;
      const audible = (tone || noise) && (env || vol > 0);
      this.levels[ch].style.width = `${audible ? (env ? 100 : (vol / 15) * 100) : 0}%`;
      this.levels[ch].classList.toggle('env', env);
      this.infos[ch].textContent = (tone ? `${freq.toFixed(1)} Hz ${noteName(freq)}` : 'tono off') +
        (noise ? ' + rumore' : '') + (env ? ' · inviluppo' : ` · vol ${vol}`);
      this.buttons[ch].classList.toggle('muted', ay.muted[ch]);
      this.buttons[ch].title = ay.muted[ch] ? 'Riattiva il canale' : 'Silenzia il canale';
    }
    this.extra.textContent = `rumore ${r[6]} · inviluppo ${r[11] | (r[12] << 8)} forma ${r[13]} · registro selezionato R${ay.selected}`;
    for (let i = 0; i < 16; i++) this.regs[i].textContent = hex(r[i], 2);
  }
}

export class AudioPanel {
  readonly el: HTMLElement;
  private meterL = h('div', { class: 'vu-bar' });
  private meterR = h('div', { class: 'vu-bar' });
  private chips: HTMLElement;
  private none = h('p', { class: 'hint' }, 'Nessuna scheda audio inserita.');
  private left: ChipView;
  private right: ChipView;
  private readonly emu: Emulator;
  private peakL = 0;
  private peakR = 0;

  constructor(emu: Emulator) {
    this.emu = emu;
    const s = emu.settings;
    const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.volume * 100), 'aria-label': 'Volume' });
    vol.addEventListener('input', () => { s.volume = Number(vol.value) / 100; emu.applyAudioSettings(); emu.save(); });
    const mono = h('input', { type: 'checkbox', checked: s.mono });
    mono.addEventListener('change', () => { s.mono = mono.checked; emu.applyAudioSettings(); emu.save(); });

    this.left = new ChipView('Sinistro (L)', () => emu.audioBoard?.left);
    this.right = new ChipView('Destro (R)', () => emu.audioBoard?.right);
    this.chips = h('div', { class: 'ay-chips' }, this.left.el, this.right.el);

    this.el = h('div', { class: 'panel-body' },
      h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Volume ', vol), h('label', {}, mono, ' mono')),
      h('div', { class: 'vu' },
        h('div', { class: 'vu-ch' }, h('span', {}, 'L'), h('div', { class: 'vu-track' }, this.meterL)),
        h('div', { class: 'vu-ch' }, h('span', {}, 'R'), h('div', { class: 'vu-track' }, this.meterR))),
      h('p', { class: 'hint' }, 'Scheda stereo: un AY-3-8910 per canale, amplificati da due LM386. Clic su un canale per silenziarlo.'),
      this.none,
      this.chips,
    );
  }

  update(): void {
    const sink = this.emu.machine.audio;
    this.peakL = Math.max(sink.peakL, this.peakL * 0.8);
    this.peakR = Math.max(sink.peakR, this.peakR * 0.8);
    sink.resetPeaks();
    this.meterL.style.width = `${Math.min(100, this.peakL * 160)}%`;
    this.meterR.style.width = `${Math.min(100, this.peakR * 160)}%`;

    const board: AudioBoard | undefined = this.emu.audioBoard;
    this.none.hidden = !!board;
    this.chips.hidden = !board;
    if (!board) return;
    this.left.setPort(board.base + 4);
    this.right.setPort(board.base);
    this.left.update(board.psgHz);
    this.right.update(board.psgHz);
  }
}
