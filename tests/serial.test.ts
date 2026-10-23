// With the 'crt' layout the serial port must show the same page as the VDU (BIOS print_crt_ch driver)
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
      // CHROUT writes to the CRT first and then to the ACIA: the CRT can be one character ahead
      const diff = a.filter((l, k) => l !== b[k]).length;
      // (lines have no trailing spaces: the extra character may follow spaces already sent)
      if (diff === 1 && a[i].startsWith(b[i]) && a[i].slice(b[i].length).trim().length === 1) return;
      throw new Error(`${what}: line ${i} differs\n  CRT    "${a[i]}"\n  serial "${b[i]}"`);
    }
  };
  check('boot menu');
  // information page: CRT and serial must match at every moment while it is printed
  tap(m, 'Digit4', 2);
  let seen = false;
  for (let f = 0; f < 240; f += 5) {
    runFrames(m, 5);
    check(`system information, frame ${f}`);
    if (term.text().includes('CPU : W65C02S')) seen = true;
  }
  assert(seen, 'the information page never appeared');
}
