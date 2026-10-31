// The two miniVIC BIOS images (standard 24.10.26 and KEYB/SD 27.10.26) on the three SD card types,
// the extended keyboard of KEYB/SD, the BIOS/SD settings and the keys the browser must not keep.
// The KEYB/SD jump table is driven by tests/fixtures/asm/bios_mailbox.bin (at $1000): the test writes a
// command in $0FF0 (1 read sector, 2 write sector, 3 SD init, 4 extended keyboard, 5 classic keyboard),
// the program calls the BIOS and leaves C/A/X/Y in $0FF1-$0FF4; the keys it reads go to $2000 (count $0FF5).
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { Machine } from '../src/core/Machine';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { buildSdImage, extendSdImage, SD_MIN_SIZE } from '../src/machines/sdimage';
import { ROMS } from '../src/machines/roms';
import { KeyboardBoard, SdCardBoard } from '../src/boards/Boards';
import { SdKind } from '../src/devices/SDCard';
import { loadSettings, saveSettings } from '../src/app/settings';
import { Emulator } from '../src/app/Emulator';
import { screenText, runFrames, assert, savePng } from './helpers';

const ROOT = process.cwd();
const rom = (id: string) => new Uint8Array(readFileSync(join(ROOT, 'public', 'roms', ROMS.find(r => r.id === id)!.file)));
const MAILBOX = new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'asm', 'bios_mailbox.bin')));
const GAMES = readdirSync(join(ROOT, 'public', 'games')).filter(f => f.endsWith('.bin')).sort().slice(0, 12);
const gameData = (f: string) => new Uint8Array(readFileSync(join(ROOT, 'public', 'games', f)));
const hex = (a: ArrayLike<number>) => Array.from(a, v => v.toString(16).padStart(2, '0')).join(' ');

/** SD image with the first games, padded to `size` bytes */
function sdImage(size: number): Uint8Array {
  const base = buildSdImage(GAMES.map(f => ({ name: f.replace(/\.bin$/, ''), data: gameData(f), load: 0x0FD0, entry: 0x1000, run: true })));
  const img = new Uint8Array(Math.max(size, base.length));
  img.set(base);
  return img;
}

function machine(bios: string, kind: SdKind, img: Uint8Array | null): Machine {
  const m = buildMachine(defaultConfig('minivic'));
  m.loadRom(rom(bios));
  const card = m.board<SdCardBoard>('sdcard')!.card;
  card.kind = kind;
  card.insert(img);
  m.powerOn();
  runFrames(m, 90);
  return m;
}

const kbOf = (m: Machine) => m.board<KeyboardBoard>('keyboard')!.keyboard;
function tap(m: Machine, code: string, mods: string[] = []): void {
  const kb = kbOf(m);
  for (const k of mods) { kb.keyDown(k); runFrames(m, 2); }
  kb.keyDown(code); runFrames(m, 3); kb.keyUp(code); runFrames(m, 3);
  for (const k of mods) { kb.keyUp(k); runFrames(m, 2); }
}

function startMailbox(m: Machine): void {
  m.ram[0x0FA0] = 0x60;   // RTS in the IRQ and NMI trampolines
  m.ram[0x0FD0] = 0x60;
  m.ram.set(MAILBOX, 0x1000);
  m.cpu.pc = 0x1000;
  runFrames(m, 2);
}

function call(m: Machine, cmd: number) {
  m.ram[0x0FF0] = cmd;
  let f = 0;
  while (m.ram[0x0FF0] && f < 600) { runFrames(m, 1); f++; }
  assert(m.ram[0x0FF0] === 0, `mailbox command ${cmd} did not finish`);
  return { c: m.ram[0x0FF1] & 1, a: m.ram[0x0FF2], x: m.ram[0x0FF3], y: m.ram[0x0FF4], frames: f };
}

function setLba(m: Machine, lba: number): void {
  for (let i = 0; i < 4; i++) m.ram[0x0316 + i] = (lba >>> (8 * i)) & 0xFF;
}

// ---------------------------------------------------------------- 1, 2: menu, BASIC, WozMon
function bootAll(): void {
  for (const [id, ver] of [['std', '24.10.26'], ['keybsd', '27.10.26 KEYB/SD']]) {
    const m = machine(id, 'sdsc-v1', null);
    const menu = screenText(m);
    savePng(m, `bios_${id}_menu`);
    assert(menu.includes('SDCARD PROGRAMS MENU') && menu.includes(`BIOS Version ${ver}`), `${id}: main menu\n${menu}`);

    tap(m, 'Digit2'); runFrames(m, 120);
    // MEMORY SIZE? and TERMINAL WIDTH?: Enter until BASIC answers
    for (let i = 0; i < 4 && !screenText(m).includes('BYTES FREE'); i++) { tap(m, 'Enter'); runFrames(m, 60); }
    const basic = screenText(m);
    assert(basic.includes('BYTES FREE') && basic.includes('OK'), `${id}: BASIC did not start\n${basic}`);

    const w = machine(id, 'sdsc-v1', null);
    tap(w, 'Digit1'); runFrames(w, 60);
    assert(screenText(w).trim() === '\\', `${id}: WozMon prompt not found`);
  }
  console.log('      both BIOS: menu with the version, BASIC (BYTES FREE, OK) and WozMon');
}

// ---------------------------------------------------------------- 3, 4: keyboard
function keyboard(): void {
  const keysOf = (m: Machine) => Array.from(m.ram.subarray(0x2000, 0x2000 + m.ram[0x0FF5]));
  // classic mode: the same codes with both BIOS (arrow up = keypad 8, '?' dropped)
  const classic: string[] = [];
  for (const id of ['std', 'keybsd']) {
    const m = machine(id, 'sdsc-v1', null);
    startMailbox(m);
    tap(m, 'KeyA'); tap(m, 'ArrowUp'); tap(m, 'Slash', ['ShiftLeft']); tap(m, 'KeyB', ['ShiftLeft']);
    classic.push(hex(keysOf(m)));
  }
  assert(classic[0] === hex([0x61, 0x38, 0x42]) && classic[1] === classic[0], `classic mode: std [${classic[0]}] keybsd [${classic[1]}]`);

  const m = machine('keybsd', 'sdsc-v1', null);
  startMailbox(m);
  const clear = () => { m.ram[0x0FF5] = 0; };
  call(m, 4);
  const seq: Array<[string, string[], number]> = [
    ['ArrowUp', [], 0x80], ['ArrowDown', [], 0x81], ['ArrowLeft', [], 0x82], ['ArrowRight', [], 0x83],
    ['Home', [], 0x84], ['End', [], 0x85], ['PageUp', [], 0x86], ['PageDown', [], 0x87],
    ['Insert', [], 0x88], ['Delete', [], 0x89],
    ['F1', [], 0x90], ['F7', [], 0x96], ['F10', [], 0x99], ['F12', [], 0x9B],
    ['KeyA', [], 0x61], ['KeyA', ['ShiftLeft'], 0x41], ['KeyA', ['ShiftRight'], 0x41],
    ['Slash', ['ShiftLeft'], 0x3F], ['Digit2', ['ShiftLeft'], 0x40], ['Quote', ['ShiftLeft'], 0x22],
    ['KeyS', ['ControlLeft'], 0x13], ['KeyC', ['ControlRight'], 0x03],
    ['KeyF', ['AltLeft'], 0xE6], ['KeyX', ['AltRight'], 0xF8],
    ['Tab', [], 0x09], ['Enter', [], 0x0D], ['NumpadEnter', [], 0x0D], ['NumpadDivide', [], 0x2F],
    ['Numpad5', [], 0x35], ['Backspace', [], 0x08], ['Escape', [], 0x1B], ['Backquote', [], 0x60],
    ['ArrowUp', ['ShiftLeft'], 0x80], ['KeyB', [], 0x62],
  ];
  const fails: string[] = [];
  for (const [k, mods, exp] of seq) {
    clear(); tap(m, k, mods);
    if (hex(keysOf(m)) !== hex([exp])) fails.push(`${[...mods, k].join('+')}: got [${hex(keysOf(m))}] expected [${hex([exp])}]`);
  }
  // Caps Lock: letters inverted, digits unchanged, Shift+letter lowercase
  clear(); tap(m, 'CapsLock'); tap(m, 'KeyQ'); tap(m, 'Digit1'); tap(m, 'KeyQ', ['ShiftLeft']); tap(m, 'CapsLock'); tap(m, 'KeyQ');
  if (hex(keysOf(m)) !== hex([0x51, 0x31, 0x71, 0x71])) fails.push('caps lock: ' + hex(keysOf(m)));
  clear(); tap(m, 'KeyZ');
  if (hex(keysOf(m)) !== hex([0x7A])) fails.push('after the modifiers: ' + hex(keysOf(m)));
  // back to classic mode
  clear(); call(m, 5); tap(m, 'ArrowUp'); tap(m, 'KeyA');
  if (hex(keysOf(m)) !== hex([0x38, 0x61])) fails.push('classic again: ' + hex(keysOf(m)));
  assert(fails.length === 0, 'extended keyboard:\n        ' + fails.join('\n        '));
  console.log(`      keyboard: classic mode equal to the standard BIOS, ${seq.length} extended keys + Caps/Ctrl/Alt`);
}

// ---------------------------------------------------------------- 5: KEYB/SD on every card type
function sdSuite(kind: SdKind, expectType: number): void {
  const img = extendSdImage(sdImage(9 * 1024 * 1024));
  assert(img.length === SD_MIN_SIZE, 'the image was not extended to 16 MB');
  const m = machine('keybsd', kind, img);
  tap(m, 'Digit3'); runFrames(m, 150);
  const menu = screenText(m);
  assert(menu.includes('SD PROGRAMS MENU'), `${kind}: SD menu not found\n${menu}`);
  tap(m, 'Digit2');
  let t = 0;
  while (m.cpu.pc >= 0x8000 && t < 1500) { runFrames(m, 10); t += 10; }
  // the game is already running and changes its variables: compare the code at $1000
  const data = gameData(GAMES[1]);
  const n = Math.min(data.length, 0x200);
  assert(m.cpu.pc < 0x8000 && hex(m.ram.subarray(0x1000, 0x0FD0 + n)) === hex(data.subarray(0x30, n)),
    `${kind}: ${GAMES[1]} not loaded from the SD menu (pc=$${m.cpu.pc.toString(16)})`);

  const orig = img.slice();
  const m2 = machine('keybsd', kind, img);
  startMailbox(m2);
  const init = call(m2, 3);
  assert(init.c === 0 && init.a === expectType, `${kind}: JT_SD_INIT C=${init.c} A=${init.a}, expected type ${expectType}`);
  const LBA = 16384 + 7;   // documents area ($00800000) + 7, past the end of the 9 MB image
  const pat = Array.from({ length: 512 }, (_, i) => (i * 7 + 3) & 0xFF);
  m2.ram.set(pat, 0x3000);
  setLba(m2, LBA);
  const w = call(m2, 2);
  assert(w.c === 0, `${kind}: write sector C=${w.c}`);
  assert(hex(img.subarray(LBA * 512, LBA * 512 + 512)) === hex(pat), `${kind}: written data not on the card`);
  assert(hex(img.subarray(0, LBA * 512)) === hex(orig.subarray(0, LBA * 512)) &&
    hex(img.subarray(LBA * 512 + 512)) === hex(orig.subarray(LBA * 512 + 512)), `${kind}: the write touched other sectors`);
  m2.ram.fill(0, 0x3000, 0x3200);
  const r = call(m2, 1);
  assert(r.c === 0 && hex(m2.ram.subarray(0x3000, 0x3200)) === hex(pat), `${kind}: read back failed`);
  setLba(m2, img.length / 512 + 10);
  assert(call(m2, 1).c === 1, `${kind}: a read past the end of the card must return C=1`);
  console.log(`      KEYB/SD + ${kind}: game from the menu in ${(t / 60).toFixed(1)} s, type ${init.a}, sector ${LBA} written and read back`);
}

// ---------------------------------------------------------------- 6: standard BIOS and SDHC
// The 24.10.26 sd_card_init repeats CMD55/ACMD41 (no CMD8, no HCS) until R1 = 0, with no timeout:
// an SDHC card never leaves the idle state, so the BIOS waits forever, as on the real hardware.
function standardBios(): void {
  const m = machine('std', 'sdhc', sdImage(0));
  tap(m, 'Digit3'); runFrames(m, 600);
  const s = screenText(m);
  savePng(m, 'bios_std_sdhc');
  assert(s.includes('READING SD DIRECTORY') && !s.includes('SD PROGRAMS MENU') && m.cpu.pc >= 0x8000,
    'standard BIOS + SDHC: expected the BIOS waiting for the card\n' + s);
  const v1 = machine('std', 'sdsc-v1', sdImage(0));
  tap(v1, 'Digit3'); runFrames(v1, 150);
  assert(screenText(v1).includes('SD PROGRAMS MENU'), 'standard BIOS + SDSC v1: SD menu not found');
  console.log('      standard BIOS: SDHC -> waits for the card (no timeout in 24.10.26), SDSC v1 -> SD menu');
}

// ---------------------------------------------------------------- 7: no card
function noCard(): void {
  const m = machine('keybsd', 'sdsc-v1', null);
  tap(m, 'Digit3');
  let f = 0;
  while (!screenText(m).includes('NO VALID SD DIRECTORY FOUND') && f < 7 * 60) { runFrames(m, 10); f += 10; }
  assert(f < 7 * 60, 'no card: no error within ~6 s\n' + screenText(m));
  console.log(`      KEYB/SD without a card: error after ${(f / 60).toFixed(1)} s`);
}

// ---------------------------------------------------------------- default full SD (public/sd_full.img.gz)
function fullSd(): void {
  const img = new Uint8Array(gunzipSync(readFileSync(join(ROOT, 'public', 'sd_full.img.gz'))));
  assert(String.fromCharCode(...img.subarray(0, 4)) === 'BOGS' && img.length >= SD_MIN_SIZE, 'sd_full.img.gz: not a 16 MB SD image');
  // program names from the paged directory (page P in the first sector of block P)
  const names: string[] = [];
  for (let p = 0; names.length < img[15]; p++) {
    const d = p * 0x8000;
    for (let i = 0; i < img[d + 5]; i++) {
      const o = d + 96 + i * 32;
      names.push(String.fromCharCode(...img.subarray(o, img.indexOf(0, o))));
    }
  }
  const idx = names.findIndex(n => /^WRITE - APP$/i.test(n));
  assert(idx >= 0, 'full SD without the Write application: ' + names.join(', '));
  assert(String.fromCharCode(...img.subarray(0x00800000, 0x00800004)) === 'DOCS', 'full SD without the document index');
  const m = machine('keybsd', 'sdsc-v1', img);
  tap(m, 'Digit3'); runFrames(m, 150);
  for (let p = 0; p < Math.floor(idx / 9); p++) { tap(m, 'KeyD'); runFrames(m, 150); }
  const menu = screenText(m);
  assert(/WRITE - APP/i.test(menu), 'SD menu page with Write not found\n' + menu);
  tap(m, `Digit${idx % 9 + 1}`);
  let t = 0;
  while (m.cpu.pc >= 0x8000 && t < 1500) { runFrames(m, 10); t += 10; }
  runFrames(m, 120);
  savePng(m, 'bios_full_sd_write');
  assert(m.cpu.pc < 0x8000, `Write did not start (pc=$${m.cpu.pc.toString(16)})`);
  console.log(`      full SD: ${names.length} programs, Write (program ${idx + 1}) started with KEYB/SD in ${(t / 60).toFixed(1)} s`);
}

// ---------------------------------------------------------------- 8: settings
function settings(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  const d = loadSettings();
  assert(d.bios === 'keybsd' && d.sdKind === 'sdsc-v1', `defaults: ${d.bios} ${d.sdKind}`);
  saveSettings({ ...d, bios: 'std', sdKind: 'sdhc' });
  const s = loadSettings();
  assert(s.bios === 'std' && s.sdKind === 'sdhc', `restored: ${s.bios} ${s.sdKind}`);
  const [key] = store.keys();
  store.set(key, JSON.stringify({ ...JSON.parse(store.get(key)!), bios: 'v99', sdKind: 'floppy' }));
  const b = loadSettings();
  assert(b.bios === 'keybsd' && b.sdKind === 'sdsc-v1', `bad values: ${b.bios} ${b.sdKind}`);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  console.log('      settings: bios/sdKind restored, bad values -> keybsd / sdsc-v1');
}

// ---------------------------------------------------------------- browser keys
function browserKeys(): void {
  // App calls preventDefault() when physicalKey() returns true (and ignores only the Meta/Cmd combos)
  const emu = new Emulator();
  emu.powered = true;
  emu.settings.keyMode = 'ps2';
  const keys = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'KeyS', 'KeyF', 'KeyP', 'KeyD', 'KeyR',
    'F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'Backspace', 'Tab', 'Space',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'];
  const kept = keys.filter(k => !(emu.physicalKey(k, true, false) && emu.physicalKey(k, false, false)));
  assert(kept.length === 0, 'keys left to the browser in keyboard mode: ' + kept.join(', '));
  emu.settings.keyMode = 'joy';
  const taken = ['F5', 'KeyP', 'Tab', 'Backspace'].filter(k => emu.physicalKey(k, true, false));
  assert(taken.length === 0, 'joystick mode takes non-joystick keys: ' + taken.join(', '));
  console.log(`      browser keys: ${keys.length} keys taken by the PS/2 keyboard, joystick mode unchanged`);
}

export default async function () {
  settings();
  browserKeys();
  bootAll();
  keyboard();
  sdSuite('sdsc-v1', 1);
  sdSuite('sdsc-v2', 2);
  sdSuite('sdhc', 3);
  standardBios();
  noCard();
  fullSd();
}
