// La seriale con l'impaginazione 'crt' deve mostrare la stessa pagina del VDU (driver print_crt_ch del BIOS)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { SerialBoard } from '../src/boards/Boards';
import { TerminalModel } from '../src/ui/TerminalModel';
import { screenText, runFrames, tap, assert } from './helpers';

export default async function () {
  const m = buildMachine(defaultConfig('minivic'));
  m.loadRom(new Uint8Array(readFileSync(join(process.cwd(), 'public', 'roms', 'minivic.bin'))));
  const term = new TerminalModel();
  m.board<SerialBoard>('serial')!.acia.onTransmit = b => term.write(b);
  m.powerOn();
  runFrames(m, 90);
  const check = (what: string) => {
    const crt = screenText(m), ser = term.text();
    if (crt !== ser) {
      const a = crt.split('\n'), b = ser.split('\n');
      const i = a.findIndex((l, k) => l !== b[k]);
      // CHROUT scrive prima sul CRT e poi sull'ACIA: il CRT puo' essere avanti di un carattere
      const diff = a.filter((l, k) => l !== b[k]).length;
      // (le righe sono senza spazi finali: il carattere in piu' puo' seguire spazi gia' trasmessi)
      if (diff === 1 && a[i].startsWith(b[i]) && a[i].slice(b[i].length).trim().length === 1) return;
      throw new Error(`${what}: riga ${i} diversa\n  CRT     "${a[i]}"\n  seriale "${b[i]}"`);
    }
  };
  check('menu di avvio');
  // pagina delle informazioni: CRT e seriale devono coincidere in ogni momento della stampa
  tap(m, 'Digit4', 2);
  let seen = false;
  for (let f = 0; f < 240; f += 5) {
    runFrames(m, 5);
    check(`informazioni di sistema, frame ${f}`);
    if (term.text().includes('CPU : W65C02S')) seen = true;
  }
  assert(seen, 'la pagina delle informazioni non e’ mai comparsa');
}
