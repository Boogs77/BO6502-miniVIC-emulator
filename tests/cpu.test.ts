// Klaus Dormann suites: 6502 functional and 65C02 extended opcodes (Rockwell instructions included).
// The (GPL) binaries are not in the repository: they are downloaded to tests/fixtures/klaus on first run.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { W65C02 } from '../src/cpu/W65C02';

const DIR = join(process.cwd(), 'tests', 'fixtures', 'klaus');
const URL = 'https://raw.githubusercontent.com/Klaus2m5/6502_65C02_functional_tests/master/bin_files/';

async function fixture(name: string): Promise<Uint8Array> {
  const p = join(DIR, name);
  if (!existsSync(p)) {
    mkdirSync(DIR, { recursive: true });
    const r = await fetch(URL + name);
    if (!r.ok) throw new Error(`download of ${name} failed: ${r.status}`);
    writeFileSync(p, new Uint8Array(await r.arrayBuffer()));
  }
  return new Uint8Array(readFileSync(p));
}

function run(image: Uint8Array, success: number, maxCycles: number): void {
  const mem = new Uint8Array(0x10000);
  mem.set(image, 0);
  const cpu = new W65C02({ read: a => mem[a], write: (a, v) => { mem[a] = v; } });
  cpu.pc = 0x0400;
  let last = -1;
  while (cpu.cycles < maxCycles) {
    const pc = cpu.pc;
    cpu.step();
    if (cpu.pc === pc && pc === last) {
      if (pc === success) { console.log(`      success at $${pc.toString(16)} after ${cpu.cycles} cycles`); return; }
      throw new Error(`error trap at $${pc.toString(16)} (cycles ${cpu.cycles})`);
    }
    last = pc;
  }
  throw new Error(`timeout, PC=$${cpu.pc.toString(16)}`);
}

export default async function () {
  run(await fixture('6502_functional_test.bin'), 0x3469, 200_000_000);
  run(await fixture('65C02_extended_opcodes_test.bin'), 0x24F1, 200_000_000);
}
