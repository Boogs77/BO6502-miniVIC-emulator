// ROM, programmi in RAM e scheda SD

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
    const loadAddr = h('input', { class: 'hex', value: '0FD0', size: 5, 'aria-label': 'Indirizzo di caricamento' });
    const entryAddr = h('input', { class: 'hex', value: '1000', size: 5, 'aria-label': 'Indirizzo di avvio' });
    const autorun = h('input', { type: 'checkbox', checked: true });

    this.el = h('div', { class: 'panel-body' },
      h('h3', {}, 'ROM (EEPROM AT28C256, 32 KB)'),
      this.romInfo,
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => this.loadRom() }, 'Carica ROM .bin'),
        h('button', { type: 'button', onclick: () => emu.loadDefaultRom().then(() => { emu.machine.loadRom(emu.romData!); emu.onState(); }) }, 'ROM predefinita')),
      h('p', { class: 'hint' }, 'Un file da 32 KB copre $8000-$FFFF; uno più corto si allinea alla fine (vettori a $FFFA). Effetto al prossimo reset.'),

      h('h3', {}, 'Programma in RAM'),
      h('div', { class: 'row' },
        h('label', {}, 'Carica a $', loadAddr),
        h('label', {}, 'Avvia da $', entryAddr),
        h('label', {}, autorun, ' avvia')),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          onclick: async () => {
            const [f] = await pickFile('.bin,.prg,.o65,.rom,*/*');
            if (!f) return;
            const load = parseHex(loadAddr.value), entry = parseHex(entryAddr.value);
            if (load === null || entry === null) return emu.onMessage('Indirizzo non valido', 'error');
            emu.loadProgram(await readFile(f), load, autorun.checked ? entry : -1);
            emu.onMessage(`${f.name} caricato a $${hex(load, 4)}`);
          },
        }, 'Carica .bin'),
        h('button', { type: 'button', onclick: () => this.loadWozmon() }, 'Carica dump WozMon .txt')),
      h('p', { class: 'hint' }, 'Il dump WozMon ("0FD0: 4C 27 11 ...") si carica agli indirizzi indicati nelle righe.'),

      h('h3', {}, 'Demo delle schede (BO6502)'),
      h('div', { class: 'row' },
        ...([['biglcd_hello.bin', 'biglcd', 'Big LCD: Hello, World!'], ['lcd16.bin', 'lcd', 'LCD 16x2'], ['leds.bin', 'leds', 'LED test']] as const)
          .map(([file, board, label]) => h('button', {
            type: 'button',
            onclick: () => emu.runDemo(file, board).catch(e => emu.onMessage(String(e), 'error')),
          }, label))),
      h('p', { class: 'hint' }, 'Programmi a $1000: Big LCD dal repo BIGLCD-65c22_test, LCD 16x2 con le routine di lcd.s, LED con l’esempio del README.'),

      h('h3', {}, 'Scheda SD'),
      this.sdInfo,
      this.sdList,
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => this.insertImage() }, 'Inserisci immagine .img'),
        h('button', { type: 'button', onclick: () => emu.loadGamesSd().then(() => emu.setSdImage(emu.sdImage, emu.sdName)) }, 'SD con i giochi'),
        h('button', { type: 'button', onclick: () => emu.setSdImage(null, '') }, 'Estrai'),
        h('button', { type: 'button', onclick: () => emu.sdImage && download(emu.sdImage, 'sd.img') }, 'Scarica .img')),
      h('h3', {}, 'Crea una SD (come make_sd.py)'),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => this.addPrograms() }, 'Aggiungi programmi .bin')),
      this.builder,
    );
    this.update();
  }

  private async loadRom(): Promise<void> {
    const [f] = await pickFile('.bin,.rom');
    if (!f) return;
    this.emu.setRom(await readFile(f), f.name);
    this.emu.onMessage(`ROM ${f.name} caricata: premi RESET`);
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
    this.emu.onMessage(count ? `${count} byte caricati da $${hex(first, 4)}` : 'Nessuna riga "ADDR: byte" nel file', count ? 'info' : 'error');
  }

  private async insertImage(): Promise<void> {
    const [f] = await pickFile('.img,.bin,*/*');
    if (!f) return;
    const data = await readFile(f);
    if (data.length < 512 || data.length % 512) return this.emu.onMessage('L’immagine deve essere un multiplo di 512 byte', 'error');
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
      h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Load'), h('th', {}, 'Entry'), h('th', {}, 'Esegui'), h('th', {}, '')));
    this.pending.forEach((p, i) => {
      const name = h('input', { value: p.name, maxlength: 31, 'aria-label': 'Nome nel menu' });
      name.addEventListener('change', () => { p.name = name.value; });
      const load = h('input', { class: 'hex', value: hex(p.load, 4), size: 5, 'aria-label': 'Indirizzo di caricamento' });
      const entry = h('input', { class: 'hex', value: hex(p.entry, 4), size: 5, 'aria-label': 'Indirizzo di avvio' });
      load.addEventListener('change', () => { const v = parseHex(load.value); if (v !== null) p.load = v; this.renderBuilder(); });
      entry.addEventListener('change', () => { const v = parseHex(entry.value); if (v !== null) p.entry = v; this.renderBuilder(); });
      const run = h('input', { type: 'checkbox', checked: p.run, 'aria-label': 'Esegui dopo il caricamento' });
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
            this.emu.setSdImage(img, `SD creata (${this.pending.length} programmi)`);
            this.emu.onMessage('SD creata e inserita');
          } catch (e) {
            this.emu.onMessage(String((e as Error).message), 'error');
          }
        },
      }, 'Crea e inserisci'),
      h('button', { type: 'button', onclick: () => { this.pending = []; this.renderBuilder(); } }, 'Svuota')));
  }

  update(): void {
    this.romInfo.textContent = this.emu.romName || 'nessuna ROM';
    const sd = this.emu.sdImage;
    this.sdInfo.textContent = sd ? `${this.emu.sdName} · ${(sd.length / 1024).toFixed(0)} KB` : 'nessuna scheda inserita';
    this.sdList.replaceChildren(...(sd ? readSdDirectory(sd) : []).map(p =>
      h('li', {}, `${p.name} `, h('span', { class: 'dim' }, `$${hex(p.load, 4)} · ${p.length} B${p.run ? ' · RUN' : ''}`))));
  }
}
