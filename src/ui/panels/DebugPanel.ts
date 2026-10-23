// Debugger: CPU, disassembly, breakpoints, memory, VDP and VIA

import { Emulator } from '../../app/Emulator';
import { disassemble } from '../../cpu/disasm';
import { h, hex, parseHex } from '../dom';
import { JoystickBoard, KeyboardBoard, SdCardBoard } from '../../boards/Boards';
import { VIA6522 } from '../../devices/VIA6522';

const FLAGS = 'NV-BDIZC';
const MODE_NAMES = ['Graphics I', 'Text', 'Multicolor', '?', 'Graphics II', 'Text (M3)', 'Multicolor (M3)', '?'];

export class DebugPanel {
  readonly el: HTMLElement;
  private regs = h('pre', { class: 'mono' });
  private dis = h('pre', { class: 'mono dis' });
  private mem = h('pre', { class: 'mono mem' });
  private vdp = h('pre', { class: 'mono' });
  private via = h('pre', { class: 'mono' });
  private memAddr = 0x0000;
  private memSpace: 'cpu' | 'vram' = 'cpu';
  private breakpoints = new Set<number>();
  private bpList = h('span', { class: 'bp-list' });
  private readonly emu: Emulator;

  constructor(emu: Emulator) {
    this.emu = emu;
    const bpInput = h('input', { class: 'hex', size: 5, placeholder: 'PC', 'aria-label': 'Breakpoint address' });
    const memInput = h('input', { class: 'hex', size: 5, value: '0000', 'aria-label': 'Memory address' });
    const space = h('select', { 'aria-label': 'Memory space' }, h('option', { value: 'cpu' }, 'CPU'), h('option', { value: 'vram' }, 'VRAM'));
    memInput.addEventListener('change', () => { const v = parseHex(memInput.value); if (v !== null) { this.memAddr = v & 0xFFF0; this.update(); } });
    space.addEventListener('change', () => { this.memSpace = space.value as 'cpu' | 'vram'; this.update(); });

    this.el = h('div', { class: 'panel-body debug' },
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => emu.paused ? emu.resume() : emu.setPaused(true) }, 'Pause / Resume'),
        h('button', { type: 'button', onclick: () => emu.step() }, 'Step'),
        h('button', { type: 'button', onclick: () => emu.stepFrame() }, 'Frame')),
      h('div', { class: 'row' },
        h('label', {}, 'Breakpoint $', bpInput),
        h('button', {
          type: 'button', class: 'small',
          onclick: () => { const v = parseHex(bpInput.value); if (v !== null) { this.breakpoints.add(v); this.syncBreakpoints(); } bpInput.value = ''; },
        }, 'Add'),
        this.bpList),
      h('div', { class: 'debug-grid' },
        h('section', {}, h('h4', {}, 'CPU W65C02S'), this.regs, this.dis),
        h('section', {}, h('h4', {}, 'VDP TMS9918A'), this.vdp, h('h4', {}, 'VIA W65C22'), this.via)),
      h('h4', {}, 'Memory ', space, ' $', memInput,
        h('button', { type: 'button', class: 'small', onclick: () => { this.memAddr = (this.memAddr - 0x80) & 0xFFFF; this.update(); } }, '▲'),
        h('button', { type: 'button', class: 'small', onclick: () => { this.memAddr = (this.memAddr + 0x80) & 0xFFFF; this.update(); } }, '▼')),
      this.mem,
    );
  }

  private syncBreakpoints(): void {
    const bps = this.breakpoints;
    this.emu.machine.breakpoint = bps.size ? pc => bps.has(pc) : null;
    this.bpList.replaceChildren(...[...bps].map(a =>
      h('button', { type: 'button', class: 'small bp', title: 'Remove', onclick: () => { bps.delete(a); this.syncBreakpoints(); } }, `$${hex(a, 4)} ✕`)));
  }

  /** the machine was rebuilt: re-apply the breakpoints */
  rebind(): void {
    this.syncBreakpoints();
  }

  update(): void {
    const m = this.emu.machine;
    const c = m.cpu;
    const flags = [...FLAGS].map((f, i) => (c.p & (0x80 >> i) ? f : '·')).join('');
    this.regs.textContent =
      `PC ${hex(c.pc, 4)}  A ${hex(c.a, 2)}  X ${hex(c.x, 2)}  Y ${hex(c.y, 2)}  SP 01${hex(c.sp, 2)}\n` +
      `P  ${flags}  IRQ ${c.irq ? 'on' : 'off'}${c.waiting ? '  WAI' : ''}${c.stopped ? '  STP' : ''}\n` +
      `cycles ${c.cycles}  frame ${m.frame}`;

    const lines: string[] = [];
    let a = c.pc;
    for (let i = 0; i < 12; i++) {
      const d = disassemble(x => m.peek(x), a);
      const mark = a === c.pc ? '▶' : this.breakpoints.has(a) ? '●' : ' ';
      lines.push(`${mark}${hex(a, 4)}  ${d.bytes.map(b => hex(b, 2)).join(' ').padEnd(9)} ${d.text}`);
      a = (a + d.bytes.length) & 0xFFFF;
    }
    this.dis.textContent = lines.join('\n');

    const vdu = m.vdu;
    if (vdu) {
      const v = vdu.vdp, r = v.reg;
      const mode = ((r[1] >> 4) & 1) | ((r[1] >> 2) & 2) | ((r[0] << 1) & 4);
      this.vdp.textContent =
        `R0-7  ${Array.from(r, x => hex(x, 2)).join(' ')}\n` +
        `mode  ${MODE_NAMES[mode]}${r[1] & 0x40 ? '' : ' (blanked)'}  sprite ${r[1] & 2 ? '16x16' : '8x8'}${r[1] & 1 ? ' x2' : ''}\n` +
        `status ${hex(v.peekStatus(), 2)}  INT ${r[1] & 0x20 ? 'on' : 'off'} -> ${vdu.irqLine.toUpperCase()}  VRAM ptr ${hex(v.vramAddress, 4)}\n` +
        `name ${hex((r[2] & 0x0F) << 10, 4)}  col ${hex(r[3] << 6, 4)}  pat ${hex((r[4] & 7) << 11, 4)}  SAT ${hex((r[5] & 0x7F) << 7, 4)}  spr ${hex((r[6] & 7) << 11, 4)}`;
    } else {
      this.vdp.textContent = 'VDU board not plugged in';
    }

    const vias: Array<[string, VIA6522, number]> = [];
    const kb = m.board<KeyboardBoard>('keyboard');
    const joy = m.board<JoystickBoard>('joystick');
    const sd = m.board<SdCardBoard>('sdcard');
    if (kb) vias.push(['KEYb', kb.via, kb.base]);
    if (joy) vias.push(['Joy', joy.via, joy.base]);
    if (sd) vias.push(['SD', sd.via, sd.base]);
    this.via.textContent = vias.map(([n, v, b]) =>
      `${n.padEnd(4)} $${hex(b, 4)} PA ${hex(v.portA(), 2)} PB ${hex(v.portB(), 2)} DDR ${hex(v.ddra, 2)}/${hex(v.ddrb, 2)} IFR ${hex(v.ifr, 2)} IER ${hex(v.ier, 2)} T1 ${hex(v.t1Counter, 4)}`,
    ).join('\n') || 'no VIA';

    const memLines: string[] = [];
    const vram = vdu?.vdp.vram;
    for (let row = 0; row < 8; row++) {
      const base = (this.memAddr + row * 16) & 0xFFFF;
      const bytes: number[] = [];
      for (let i = 0; i < 16; i++) {
        const addr = (base + i) & 0xFFFF;
        bytes.push(this.memSpace === 'vram' ? (vram ? vram[addr & 0x3FFF] : 0) : m.peek(addr));
      }
      const ascii = bytes.map(b => (b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.')).join('');
      memLines.push(`${hex(base, 4)}  ${bytes.map(b => hex(b, 2)).join(' ')}  ${ascii}`);
    }
    this.mem.textContent = memLines.join('\n');
  }
}
