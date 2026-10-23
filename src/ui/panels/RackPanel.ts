// Board rack: plug in/out, base address and interrupt line (only with the machine off)

import { Emulator } from '../../app/Emulator';
import { BO6502_CLOCKS, BOARD_INFO, isConfigurable } from '../../machines/profiles';
import { IrqLine } from '../../core/Board';
import { h, hex, parseHex } from '../dom';

export class RackPanel {
  readonly el: HTMLElement;
  private readonly emu: Emulator;

  constructor(emu: Emulator) {
    this.emu = emu;
    this.el = h('div', { class: 'panel-body' });
    this.update();
  }

  update(): void {
    const emu = this.emu;
    const cfg = emu.config;
    const editable = isConfigurable(cfg.id) && !emu.powered;
    const fixed = !isConfigurable(cfg.id);

    const slot = (title: string, chips: string, range: string, enabled: boolean, onToggle: ((on: boolean) => void) | null, extra?: Node) => {
      const sw = h('input', { type: 'checkbox', checked: enabled, disabled: !editable || !onToggle, 'aria-label': `Plug in ${title}` });
      if (onToggle) sw.addEventListener('change', () => onToggle(sw.checked));
      return h('div', { class: 'slot' + (enabled ? ' on' : '') },
        h('div', { class: 'slot-led' }),
        h('div', { class: 'slot-main' },
          h('div', { class: 'slot-title' }, title, h('span', { class: 'slot-range' }, range)),
          h('div', { class: 'slot-chips' }, chips),
          extra ?? null),
        onToggle ? h('label', { class: 'switch' }, sw, h('span', {})) : h('span', {}));
    };

    const slots: Node[] = [
      slot('CPU', 'W65C02S', `${cfg.cpuHz / 1e6} MHz`, true, null,
        cfg.id === 'bo6502' ? this.clockSelect(editable) : undefined),
      slot('RAM', 'HM62256LP 32 KB', '$0000-$7FFF', cfg.ram, on => emu.updateConfig(c => { c.ram = on; })),
      slot('ROM', 'AT28C256 32 KB (I/O $B000-$DFFF excluded)', '$8000-$FFFF', cfg.rom, on => emu.updateConfig(c => { c.rom = on; })),
    ];

    cfg.boards.forEach((b, i) => {
      const info = BOARD_INFO[b.type];
      const end = b.base + info.size - 1;
      const addr = h('input', { class: 'hex', value: hex(b.base, 4), size: 5, disabled: !editable, 'aria-label': `${info.name} address` });
      addr.addEventListener('change', () => {
        const v = parseHex(addr.value);
        if (v === null || v % info.step) {
          emu.onMessage(`Invalid address: must be a multiple of $${hex(info.step, 1)}`, 'error');
          addr.value = hex(b.base, 4);
          return;
        }
        emu.updateConfig(c => { c.boards[i].base = v; });
      });
      const extra = h('div', { class: 'slot-opts' }, h('label', {}, 'Base $', addr));
      if (info.hasIrq) {
        const sel = h('select', { disabled: !editable, 'aria-label': `Interrupt ${info.name}` },
          ...(['irq', 'nmi', 'none'] as IrqLine[]).map(l => h('option', { value: l, selected: b.irq === l }, l === 'none' ? 'none' : l.toUpperCase())));
        sel.addEventListener('change', () => emu.updateConfig(c => { c.boards[i].irq = sel.value as IrqLine; }));
        extra.append(h('label', {}, 'INT ', sel));
      }
      if (b.type === 'lcd') {
        const wiring = h('select', { disabled: !editable, 'aria-label': 'LCD wiring' },
          h('option', { value: '4bit', selected: b.option !== '8bit' }, '4 bit: PB0-3 data, PB4 RS, PB5 RW, PB6 E'),
          h('option', { value: '8bit', selected: b.option === '8bit' }, '8 bit: PB data, PA5 RS, PA6 RW, PA7 E'));
        wiring.addEventListener('change', () => emu.updateConfig(c => { c.boards[i].option = wiring.value; }));
        extra.append(h('label', {}, 'Wiring ', wiring));
      }
      // overlapping boards: on the bus the one higher in the rack wins
      if (b.enabled) {
        const clash = cfg.boards.filter((o, j) => j !== i && o.enabled &&
          o.base <= end && b.base <= o.base + BOARD_INFO[o.type].size - 1);
        if (clash.length) {
          extra.append(h('div', { class: 'err' },
            `Bus conflict with ${clash.map(o => BOARD_INFO[o.type].name).join(', ')}` +
            (cfg.boards.indexOf(clash[0]) < i ? ' (the other board answers)' : '')));
        }
      }
      slots.push(slot(info.name, info.chips, `$${hex(b.base, 4)}-$${hex(end, 4)}`, b.enabled,
        on => emu.updateConfig(c => { c.boards[i].enabled = on; }), extra));
    });

    const ramInit = h('select', { 'aria-label': 'RAM at power-on' },
      h('option', { value: 'zero', selected: !emu.settings.randomRam }, 'cleared'),
      h('option', { value: 'random', selected: emu.settings.randomRam }, 'random (like real SRAMs)'));
    ramInit.addEventListener('change', () => { emu.settings.randomRam = ramInit.value === 'random'; emu.save(); });

    this.el.replaceChildren(
      h('p', { class: 'hint' }, fixed
        ? 'The miniVIC has a fixed configuration. Switch to the BO6502 to change the boards in the rack.'
        : emu.powered
          ? 'Power the machine off to plug or unplug boards and change their addresses.'
          : '39-pin backplane: plug in the boards and set their addresses, just like the real jumpers.'),
      h('div', { class: 'rack' }, ...slots),
      h('div', { class: 'row' }, h('label', {}, 'RAM at power-on ', ramInit)),
      h('p', { class: 'hint' }, 'Random RAM reveals variables that are read before being initialised (applies from the next power-on).'),
      editable ? h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => emu.resetConfig() }, 'Factory configuration')) : '',
      h('p', { class: 'hint' }, 'Legacy LCD and LED test decode the whole $Dxxx page like the real boards: use them alone or move them to another page.'),
    );
  }

  private clockSelect(editable: boolean): HTMLElement {
    const sel = h('select', { disabled: !editable, 'aria-label': 'CPU clock' },
      ...BO6502_CLOCKS.map(hz => h('option', { value: hz, selected: this.emu.config.cpuHz === hz }, `${hz / 1e6} MHz`)));
    sel.addEventListener('change', () => this.emu.updateConfig(c => { c.cpuHz = Number(sel.value); }));
    return h('div', { class: 'slot-opts' }, h('label', {}, 'Clock (RESET) ', sel));
  }
}
