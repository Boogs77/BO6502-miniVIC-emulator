// Rack delle schede: inserimento, indirizzo e linea di interrupt (solo a macchina spenta)

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
      const sw = h('input', { type: 'checkbox', checked: enabled, disabled: !editable || !onToggle, 'aria-label': `Inserisci ${title}` });
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
      slot('ROM', 'AT28C256 32 KB (I/O $B000-$DFFF esclusi)', '$8000-$FFFF', cfg.rom, on => emu.updateConfig(c => { c.rom = on; })),
    ];

    cfg.boards.forEach((b, i) => {
      const info = BOARD_INFO[b.type];
      const end = b.base + info.size - 1;
      const addr = h('input', { class: 'hex', value: hex(b.base, 4), size: 5, disabled: !editable, 'aria-label': `Indirizzo ${info.name}` });
      addr.addEventListener('change', () => {
        const v = parseHex(addr.value);
        if (v === null || v % info.step) {
          emu.onMessage(`Indirizzo non valido: multiplo di $${hex(info.step, 1)}`, 'error');
          addr.value = hex(b.base, 4);
          return;
        }
        emu.updateConfig(c => { c.boards[i].base = v; });
      });
      const extra = h('div', { class: 'slot-opts' }, h('label', {}, 'Base $', addr));
      if (info.hasIrq) {
        const sel = h('select', { disabled: !editable, 'aria-label': `Interrupt ${info.name}` },
          ...(['irq', 'nmi', 'none'] as IrqLine[]).map(l => h('option', { value: l, selected: b.irq === l }, l === 'none' ? 'nessuno' : l.toUpperCase())));
        sel.addEventListener('change', () => emu.updateConfig(c => { c.boards[i].irq = sel.value as IrqLine; }));
        extra.append(h('label', {}, 'INT ', sel));
      }
      if (b.type === 'lcd') {
        const wiring = h('select', { disabled: !editable, 'aria-label': 'Cablaggio LCD' },
          h('option', { value: '4bit', selected: b.option !== '8bit' }, '4 bit: PB0-3 dati, PB4 RS, PB5 RW, PB6 E'),
          h('option', { value: '8bit', selected: b.option === '8bit' }, '8 bit: PB dati, PA5 RS, PA6 RW, PA7 E'));
        wiring.addEventListener('change', () => emu.updateConfig(c => { c.boards[i].option = wiring.value; }));
        extra.append(h('label', {}, 'Cablaggio ', wiring));
      }
      // schede inserite che si sovrappongono: sul bus vince quella piu' in alto nel rack
      if (b.enabled) {
        const clash = cfg.boards.filter((o, j) => j !== i && o.enabled &&
          o.base <= end && b.base <= o.base + BOARD_INFO[o.type].size - 1);
        if (clash.length) {
          extra.append(h('div', { class: 'err' },
            `Conflitto sul bus con ${clash.map(o => BOARD_INFO[o.type].name).join(', ')}` +
            (cfg.boards.indexOf(clash[0]) < i ? ' (risponde l’altra scheda)' : '')));
        }
      }
      slots.push(slot(info.name, info.chips, `$${hex(b.base, 4)}-$${hex(end, 4)}`, b.enabled,
        on => emu.updateConfig(c => { c.boards[i].enabled = on; }), extra));
    });

    const ramInit = h('select', { 'aria-label': 'RAM all’accensione' },
      h('option', { value: 'zero', selected: !emu.settings.randomRam }, 'azzerata'),
      h('option', { value: 'random', selected: emu.settings.randomRam }, 'casuale (come le SRAM reali)'));
    ramInit.addEventListener('change', () => { emu.settings.randomRam = ramInit.value === 'random'; emu.save(); });

    this.el.replaceChildren(
      h('p', { class: 'hint' }, fixed
        ? 'Il miniVIC ha una configurazione fissa. Passa al BO6502 per cambiare le schede del rack.'
        : emu.powered
          ? 'Spegni la macchina per inserire o togliere schede e cambiare gli indirizzi.'
          : 'Backplane a 39 pin: inserisci le schede e imposta gli indirizzi come con i jumper reali.'),
      h('div', { class: 'rack' }, ...slots),
      h('div', { class: 'row' }, h('label', {}, 'RAM all’accensione ', ramInit)),
      h('p', { class: 'hint' }, 'Con la RAM casuale si scoprono le variabili lette prima di essere inizializzate (vale dalla prossima accensione).'),
      editable ? h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => emu.resetConfig() }, 'Configurazione di fabbrica')) : '',
      h('p', { class: 'hint' }, 'LCD legacy e LED test decodificano tutta la pagina $Dxxx come le schede reali: si usano da sole o spostate in un’altra pagina.'),
    );
  }

  private clockSelect(editable: boolean): HTMLElement {
    const sel = h('select', { disabled: !editable, 'aria-label': 'Clock della CPU' },
      ...BO6502_CLOCKS.map(hz => h('option', { value: hz, selected: this.emu.config.cpuHz === hz }, `${hz / 1e6} MHz`)));
    sel.addEventListener('change', () => this.emu.updateConfig(c => { c.cpuHz = Number(sel.value); }));
    return h('div', { class: 'slot-opts' }, h('label', {}, 'Clock (RESET) ', sel));
  }
}
