// ROM, programs in RAM and SD card

import { Emulator } from '../../app/Emulator';
import { buildSdImage, checkProgram, defaultEntry, readSdDirectory, SdProgram } from '../../machines/sdimage';
import { download, h, hex, parseHex, pickFile, readFile } from '../dom';

export class MediaPanel {
  readonly el: HTMLElement;
  private romInfo = h('div', { class: 'info' });
  private sdInfo = h('div', { class: 'info' });
  private sdList = h('ol', { class: 'sd-dir' });
  private builder = h('div', { class: 'sd-builder' });
  private pending: SdProgram[] = [];
  private readonly emu: Emulator;

  constructor(emu: Emulator) {
    this.emu = emu;
    const loadAddr = h('input', { class: 'hex', value: '0FD0', size: 5, 'aria-label': 'Load address' });
    const entryAddr = h('input', { class: 'hex', value: '1000', size: 5, 'aria-label': 'Start address' });
    const autorun = h('input', { type: 'checkbox', checked: true });

    this.el = h('div', { class: 'panel-body' },
      h('h3', {}, 'ROM (EEPROM AT28C256, 32 KB)'),
      this.romInfo,
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => this.loadRom() }, 'Load ROM .bin'),
        h('button', { type: 'button', onclick: () => emu.loadDefaultRom().then(() => { emu.machine.loadRom(emu.romData!); emu.onState(); }) }, 'Default ROM')),
      h('p', { class: 'hint' }, 'A 32 KB file covers $8000-$FFFF; a shorter one is aligned to the end (vectors at $FFFA). Takes effect at the next reset.'),

      h('h3', {}, 'Program in RAM'),
      h('div', { class: 'row' },
        h('label', {}, 'Load at $', loadAddr),
        h('label', {}, 'Start at $', entryAddr),
        h('label', {}, autorun, ' run')),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          onclick: async () => {
            const [f] = await pickFile('.bin,.prg,.o65,.rom,*/*');
            if (!f) return;
            const load = parseHex(loadAddr.value), entry = parseHex(entryAddr.value);
            if (load === null || entry === null) return emu.onMessage('Invalid address', 'error');
            emu.loadProgram(await readFile(f), load, autorun.checked ? entry : -1);
            emu.onMessage(`${f.name} loaded at $${hex(load, 4)}`);
          },
        }, 'Load .bin'),
        h('button', { type: 'button', onclick: () => this.loadWozmon() }, 'Load WozMon dump .txt')),
      h('p', { class: 'hint' }, 'A WozMon dump ("0FD0: 4C 27 11 ...") is loaded at the addresses written in its lines.'),

      h('h3', {}, 'Board demos (BO6502)'),
      h('div', { class: 'row' },
        ...([['biglcd_hello.bin', 'biglcd', 'Big LCD: Hello, World!'], ['lcd16.bin', 'lcd', 'LCD 16x2'], ['leds.bin', 'leds', 'LED test']] as const)
          .map(([file, board, label]) => h('button', {
            type: 'button',
            onclick: () => emu.runDemo(file, board).catch(e => emu.onMessage(String(e), 'error')),
          }, label))),
      h('p', { class: 'hint' }, 'Programs at $1000: Big LCD from the BIGLCD-65c22_test repo, LCD 16x2 with the lcd.s routines, LEDs with the README example.'),

      h('h3', {}, 'SD card'),
      this.sdInfo,
      this.sdList,
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => this.insertImage() }, 'Insert .img image'),
        h('button', { type: 'button', onclick: () => emu.loadGamesSd().then(() => emu.setSdImage(emu.sdImage, emu.sdName)) }, 'Games SD'),
        h('button', { type: 'button', onclick: () => emu.setSdImage(null, '') }, 'Eject'),
        h('button', { type: 'button', onclick: () => emu.sdImage && download(emu.sdImage, 'sd.img') }, 'Download .img')),
      h('h3', {}, 'Build an SD card (like make_sd.py)'),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => this.addPrograms() }, 'Add .bin programs')),
      this.builder,
    );
    this.update();
  }

  private async loadRom(): Promise<void> {
    const [f] = await pickFile('.bin,.rom');
    if (!f) return;
    this.emu.setRom(await readFile(f), f.name);
    this.emu.onMessage(`ROM ${f.name} loaded: press RESET`);
  }

  private async loadWozmon(): Promise<void> {
    const [f] = await pickFile('.txt,.hex,.woz');
    if (!f) return;
    const text = await f.text();
    let first = -1, count = 0;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([0-9a-f]{1,4})\s*:\s*((?:[0-9a-f]{2}\s*)+)$/i);
      if (!m) continue;
      const addr = parseInt(m[1], 16);
      const bytes = m[2].trim().split(/\s+/).map(b => parseInt(b, 16));
      if (first < 0) first = addr;
      this.emu.loadProgram(Uint8Array.from(bytes), addr, -1);
      count += bytes.length;
    }
    this.emu.onMessage(count ? `${count} bytes loaded from $${hex(first, 4)}` : 'No "ADDR: bytes" line in the file', count ? 'info' : 'error');
  }

  private async insertImage(): Promise<void> {
    const [f] = await pickFile('.img,.bin,*/*');
    if (!f) return;
    const data = await readFile(f);
    if (data.length < 512 || data.length % 512) return this.emu.onMessage('The image size must be a multiple of 512 bytes', 'error');
    this.emu.setSdImage(data, f.name);
  }

  private async addPrograms(): Promise<void> {
    const files = await pickFile('.bin,*/*', true);
    for (const f of files) {
      const data = await readFile(f);
      const load = 0x0FD0;
      this.pending.push({ name: f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '), data, load, entry: defaultEntry(load, data.length), run: true });
    }
    this.renderBuilder();
  }

  private renderBuilder(): void {
    this.builder.replaceChildren();
    if (!this.pending.length) return;
    const table = h('table', { class: 'sd-table' },
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Load'), h('th', {}, 'Entry'), h('th', {}, 'Run'), h('th', {}, '')));
    this.pending.forEach((p, i) => {
      const name = h('input', { value: p.name, maxlength: 31, 'aria-label': 'Name in the menu' });
      name.addEventListener('change', () => { p.name = name.value; });
      const load = h('input', { class: 'hex', value: hex(p.load, 4), size: 5, 'aria-label': 'Load address' });
      const entry = h('input', { class: 'hex', value: hex(p.entry, 4), size: 5, 'aria-label': 'Start address' });
      load.addEventListener('change', () => { const v = parseHex(load.value); if (v !== null) p.load = v; this.renderBuilder(); });
      entry.addEventListener('change', () => { const v = parseHex(entry.value); if (v !== null) p.entry = v; this.renderBuilder(); });
      const run = h('input', { type: 'checkbox', checked: p.run, 'aria-label': 'Run after loading' });
      run.addEventListener('change', () => { p.run = run.checked; });
      const err = checkProgram(p);
      table.append(h('tr', { class: err ? 'bad' : '' },
        h('td', {}, name, err ? h('div', { class: 'err' }, err) : null),
        h('td', {}, load), h('td', {}, entry), h('td', {}, run),
        h('td', {}, h('button', { type: 'button', class: 'small', onclick: () => { this.pending.splice(i, 1); this.renderBuilder(); } }, '✕'))));
    });
    this.builder.append(table, h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'primary',
        onclick: () => {
          try {
            const img = buildSdImage(this.pending);
            this.emu.setSdImage(img, `Built SD (${this.pending.length} programs)`);
            this.emu.onMessage('SD card built and inserted');
          } catch (e) {
            this.emu.onMessage(String((e as Error).message), 'error');
          }
        },
      }, 'Build and insert'),
      h('button', { type: 'button', onclick: () => { this.pending = []; this.renderBuilder(); } }, 'Clear')));
  }

  update(): void {
    this.romInfo.textContent = this.emu.romName || 'no ROM';
    const sd = this.emu.sdImage;
    this.sdInfo.textContent = sd ? `${this.emu.sdName} · ${(sd.length / 1024).toFixed(0)} KB` : 'no card inserted';
    this.sdList.replaceChildren(...(sd ? readSdDirectory(sd) : []).map(p =>
      h('li', {}, `${p.name} `, h('span', { class: 'dim' }, `$${hex(p.load, 4)} · ${p.length} B${p.run ? ' · RUN' : ''}`))));
  }
}
