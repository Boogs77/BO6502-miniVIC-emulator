// BO6502 output boards with real 65C02 programs (tests/fixtures/asm, assembled with vasm)
//   Big LCD T6963: BIGLCD_HELLOWORLD.ASM from github.com/Boogs77/BIGLCD-65c22_test
//   LCD 16x2: 4-bit routines of the BIOS lcd.s, with busy flag reads
//   LED test: example from the board README
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMachine, defaultConfig, MachineConfig } from '../src/machines/profiles';
import { BigLcdBoard, LcdBoard, LedBoard } from '../src/boards/DisplayBoards';
import { T6963_H, T6963_W } from '../src/devices/T6963';
import { glyph } from '../src/devices/font5x8';
import { runFrames, writePng, assert } from './helpers';

const ROOT = process.cwd();
const fixture = (n: string) => new Uint8Array(readFileSync(join(ROOT, 'tests', 'fixtures', 'asm', n)));

function machine(change: (c: MachineConfig) => void) {
  const cfg = defaultConfig('bo6502');
  change(cfg);
  const m = buildMachine(cfg);
  m.loadRom(new Uint8Array(readFileSync(join(ROOT, 'public', 'roms', 'minivic.bin'))));
  m.powerOn();
  runFrames(m, 5);
  return m;
}

function run(m: ReturnType<typeof machine>, bin: Uint8Array, frames: number) {
  m.poke(0x1000, bin);
  m.cpu.pc = 0x1000;
  m.cpu.sp = 0xFF;
  runFrames(m, frames);
}

function testBigLcd(): void {
  const m = machine(() => {});
  run(m, fixture('biglcd_hello.bin'), 1);
  let t = 0;
  while (m.cpu.pc < 0xFE00 && t < 600) { runFrames(m, 10); t += 10; } // it ends with JMP $FE00 (WozMon)
  console.log(`      Big LCD ready after ${(t / 60).toFixed(1)} emulated s`);
  const lcd = m.board<BigLcdBoard>('biglcd')!.lcd;
  let text = '';
  for (let i = 0; i < 13; i++) text += String.fromCharCode(lcd.ram[lcd.textHome + i] + 0x20);
  assert(text === 'Hello, World!', `text in the T6963 RAM: "${text}"`);
  assert(lcd.display === 0x07 && lcd.textArea === 20 && lcd.graphicHome === 0x0800, 'T6963 registers');
  const px = new Uint8Array(T6963_W * T6963_H);
  lcd.render(px, true);
  writePng('biglcd_hello', T6963_W * 2, T6963_H * 2, (x, y) => (px[(y >> 1) * T6963_W + (x >> 1)] ? [236, 244, 255] : [30, 52, 196]));
}

function testCharLcd(): void {
  const m = machine(c => {
    for (const b of c.boards) if (b.type !== 'vdu' && b.type !== 'serial') b.enabled = false;
    c.boards.find(b => b.type === 'lcd')!.enabled = true;
  });
  run(m, fixture('lcd16.bin'), 30);
  const lcd = m.board<LcdBoard>('lcd')!.lcd;
  const line = (r: number) => Array.from({ length: 16 }, (_, c) => String.fromCharCode(lcd.charAt(r, c))).join('').trimEnd();
  assert(!lcd.eightBit && lcd.twoLines && lcd.displayOn && lcd.cursorOn, 'HD44780 state');
  assert(line(0) === 'BO6502 LCD 16x2' && line(1) === 'HD44780 4 BIT!', `lines: "${line(0)}" / "${line(1)}"`);
  writePng('lcd16', 16 * 6 * 3, 2 * 9 * 3, (x, y) => {
    const c = Math.floor(x / 18), r = Math.floor(y / 27);
    const gx = Math.floor((x % 18) / 3), gy = Math.floor((y % 27) / 3);
    const on = gx < 5 && gy < 8 && (glyph(lcd.charAt(r, c))[gy] & (0x80 >> gx));
    return on ? [31, 42, 10] : [155, 189, 36];
  });
}

function testLeds(): void {
  const m = machine(c => {
    for (const b of c.boards) if (b.type !== 'vdu' && b.type !== 'serial') b.enabled = false;
    c.boards.find(b => b.type === 'leds')!.enabled = true;
  });
  run(m, fixture('leds.bin'), 2);
  const leds = m.board<LedBoard>('leds')!.leds;
  assert(leds === 0x3CA5, `LED: $${leds.toString(16)}`);
}

export default async function () {
  testBigLcd();
  testCharLcd();
  testLeds();
}
