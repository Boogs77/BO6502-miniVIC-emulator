// The SD save area (sectors from 16 MB, devices/SaveArea.ts): the class alone (records, JSON export),
// then the KEYB/SD BIOS writing and reading a sector of the area on the three card types, through
// tests/fixtures/asm/bios_mailbox.bin (command in $0FF0: 1 read sector, 2 write sector, 3 SD init;
// C/A/X/Y back in $0FF1-$0FF4; buffer X/Y = $3000).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Machine } from '../src/core/Machine';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { buildSdImage, extendSdImage, SD_MIN_SIZE } from '../src/machines/sdimage';
import { ROMS } from '../src/machines/roms';
import { SdCardBoard } from '../src/boards/Boards';
import { SdKind } from '../src/devices/SDCard';
import { SaveArea, SAVE_FIRST, SAVE_SECTORS, SAVE_ZONE } from '../src/devices/SaveArea';
import { runFrames, assert } from './helpers';

const ROOT = process.cwd();
const ROM = new Uint8Array(readFileSync(join(ROOT, 'public', 'roms', ROMS.find(r => r.id === 'keybsd')!.file)));
const MAILBOX = new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'asm', 'bios_mailbox.bin')));
const hex = (a: ArrayLike<number>) => Array.from(a, v => v.toString(16).padStart(2, '0')).join(' ');

/** a records sector as the games write it: 1 table of 8 rows, row 0 = given score/initials */
function recordsSector(zone: number, game: string, counter: number, score: number[], name: string): Uint8Array {
  const s = new Uint8Array(512);
  s.set([0x4D, 0x56, 0x53, 0x56, 1, zone, 1, 1, 8, 8, counter & 0xFF, counter >> 8]);
  s.set(Array.from(game.padEnd(16).slice(0, 16), c => c.charCodeAt(0)), 16);
  for (let i = 0; i < 8; i++) s.set([0, 0, 0, 0, 0x2D, 0x2D, 0x2D, 0], 32 + i * 8);
  s.set([...score, ...Array.from(name, c => c.charCodeAt(0)), 6], 32);
  let sum = 0;
  for (let i = 0; i < 510; i++) sum = (sum + s[i]) & 0xFFFF;
  s[510] = sum & 0xFF; s[511] = sum >> 8;
  return s;
}

function unit(): void {
  const a = new SaveArea();
  const writes: number[] = [];
  a.onWrite = n => writes.push(n);
  assert(SaveArea.contains(SAVE_FIRST) && SaveArea.contains(SAVE_FIRST + SAVE_SECTORS - 1) &&
    !SaveArea.contains(SAVE_FIRST - 1) && !SaveArea.contains(SAVE_FIRST + SAVE_SECTORS), 'area bounds');
  assert(a.read(SAVE_FIRST + 5).every(b => b === 0), 'a sector never written reads as zeros');
  // zone 28: copy 0 older, copy 1 newer; zone 3: copy 0 broken (bad checksum)
  const z = SAVE_FIRST + 28 * SAVE_ZONE;
  a.write(z, recordsSector(28, 'DUNE RANGER', 4, [0x50, 0x76, 0x01, 0x00], 'OLD'));
  a.write(z + 1, recordsSector(28, 'DUNE RANGER', 5, [0x00, 0x26, 0x04, 0x00], 'MAB'));
  const bad = recordsSector(3, 'CENTIPEDE', 1, [0x10, 0, 0, 0], 'XYZ');
  bad[100] ^= 1;
  a.write(SAVE_FIRST + 3 * SAVE_ZONE, bad);
  const recs = a.records();
  assert(recs.length === 1 && recs[0].zone === 28 && recs[0].game === 'DUNE RANGER' && recs[0].counter === 5,
    'records: ' + JSON.stringify(recs.map(r => [r.zone, r.game, r.counter])));
  assert(recs[0].rows[0].score === '42600' && recs[0].rows[0].name === 'MAB' && recs[0].rows[0].extra === 6 &&
    recs[0].rows[1].name === '---', 'row 0: ' + JSON.stringify(recs[0].rows.slice(0, 2)));
  // writing zeros erases the sector
  a.write(SAVE_FIRST + 9, new Uint8Array(512));
  assert(!a.sectors.has(SAVE_FIRST + 9) && a.sectors.size === 3, 'zeros must not be kept');
  // JSON round trip into another area
  const json = JSON.parse(JSON.stringify(a.toJSON()));
  const b = new SaveArea();
  assert(b.fromJSON(json) === 3 && hex(b.read(z + 1)) === hex(a.read(z + 1)), 'JSON import');
  let threw = false;
  try { b.fromJSON({ format: 'minivic-saves', sectors: { 100: json.sectors[z] } }); } catch { threw = true; }
  assert(threw && b.sectors.size === 3, 'a sector outside the area must be refused, leaving the area as it was');
  assert(writes.length === 4, `onWrite calls: ${writes.length}`);
  console.log('      SaveArea: bounds, newest valid copy, bad checksum skipped, JSON export/import');
}

function machine(kind: SdKind, img: Uint8Array, area: SaveArea | null): Machine {
  const m = buildMachine(defaultConfig('minivic'));
  m.loadRom(ROM);
  const card = m.board<SdCardBoard>('sdcard')!.card;
  card.kind = kind;
  card.saveArea = area;
  card.insert(img);
  m.powerOn();
  runFrames(m, 90);
  m.ram[0x0FA0] = 0x60;   // RTS in the IRQ and NMI trampolines
  m.ram[0x0FD0] = 0x60;
  m.ram.set(MAILBOX, 0x1000);
  m.cpu.pc = 0x1000;
  runFrames(m, 2);
  return m;
}

function call(m: Machine, cmd: number, lba?: number) {
  if (lba !== undefined) for (let i = 0; i < 4; i++) m.ram[0x0316 + i] = (lba >>> (8 * i)) & 0xFF;
  m.ram[0x0FF0] = cmd;
  let f = 0;
  while (m.ram[0x0FF0] && f < 600) { runFrames(m, 1); f++; }
  assert(m.ram[0x0FF0] === 0, `mailbox command ${cmd} did not finish`);
  return { c: m.ram[0x0FF1] & 1, a: m.ram[0x0FF2] };
}

function bios(kind: SdKind): void {
  const img = extendSdImage(buildSdImage([{ name: 'test', data: new Uint8Array(300), load: 0x1000, entry: 0x1000, run: false }]));
  assert(img.length === SD_MIN_SIZE, 'image not extended to 16 MB');
  const orig = img.slice();
  const area = new SaveArea();
  const m = machine(kind, img, area);
  assert(call(m, 3).c === 0, `${kind}: SD init`);
  const LBA = SAVE_FIRST + 28 * SAVE_ZONE + 1;   // zone 28, copy 1 of the records
  const pat = recordsSector(28, 'DUNE RANGER', 1, [0x00, 0x15, 0x00, 0x00], 'BOG');
  m.ram.set(pat, 0x3000);
  assert(call(m, 2, LBA).c === 0, `${kind}: write in the save area failed`);
  assert(hex(area.read(LBA)) === hex(pat), `${kind}: the sector is not in the save area`);
  assert(img.length === SD_MIN_SIZE && hex(img) === hex(orig), `${kind}: the SD image was changed`);
  m.ram.fill(0, 0x3000, 0x3200);
  assert(call(m, 1, LBA).c === 0 && hex(m.ram.subarray(0x3000, 0x3200)) === hex(pat), `${kind}: read back failed`);
  assert(area.records()[0]?.rows[0].name === 'BOG', `${kind}: records not readable`);
  assert(call(m, 1, SAVE_FIRST + 7).c === 0 && m.ram.subarray(0x3000, 0x3200).every(b => b === 0),
    `${kind}: an empty sector of the area must read as zeros`);
  assert(call(m, 1, SAVE_FIRST + SAVE_SECTORS).c === 1, `${kind}: a read past the area must fail`);
  // the same sector without a save area: past the end of the 16 MB image, so an error (old behaviour)
  const m2 = machine(kind, img, null);
  call(m2, 3);
  assert(call(m2, 2, LBA).c === 1, `${kind}: without a save area the write must fail`);
  console.log(`      KEYB/SD + ${kind}: sector ${LBA} of the save area written and read back, image untouched`);
}

export default function (): void {
  unit();
  for (const k of ['sdsc-v1', 'sdsc-v2', 'sdhc'] as SdKind[]) bios(k);
}
