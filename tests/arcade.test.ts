// Arcade6502 with the Arcade BIOS and the cabinet SD: front-end list, 8-bit control panels, cabinet switches,
// a game started from the front-end and left with both START, a game loaded straight into RAM (as the Games panel
// does on this machine: through JT_INIT_CRT), the joystick test opened by the TEST switch.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import {
  JoystickBoard, SdCardBoard, SerialBoard,
  JOY_DOWN, JOY_FIRE1, JOY_FIRE3, JOY_START, SW_COIN1, SW_COIN2, SW_TEST,
} from '../src/boards/Boards';
import { Machine } from '../src/core/Machine';
import { savePng, screenText, runFrames, assert } from './helpers';

const ROOT = process.cwd();
const ROM = new Uint8Array(readFileSync(join(ROOT, 'public', 'roms', 'arcade.bin')));
const SD = new Uint8Array(gunzipSync(readFileSync(join(ROOT, 'public', 'sd_arcade.img.gz'))));

/** Graphics II name table as text (32x24), the front-end screens */
function rows(m: Machine): string[] {
  const vdp = m.vdu!.vdp, nt = (vdp.reg[2] & 0x0F) << 10, out: string[] = [];
  for (let r = 0; r < 24; r++) {
    let s = '';
    for (let c = 0; c < 32; c++) {
      const ch = vdp.vram[nt + r * 32 + c] & 0x7F;
      s += ch >= 0x20 && ch < 0x7F ? String.fromCharCode(ch) : '.';
    }
    out.push(s);
  }
  return out;
}

const g2 = (m: Machine) => (m.vdu!.vdp.reg[0] & 2) !== 0;
const inList = (m: Machine) => g2(m) && rows(m)[2].startsWith(' SELECT A GAME');

function waitFor(m: Machine, cond: () => boolean, max: number, what: string): number {
  for (let i = 0; i < max; i++) {
    if (cond()) return i;
    m.runFrame();
  }
  throw new Error(`timeout: ${what}\n${g2(m) ? rows(m).join('\n') : screenText(m)}`);
}

function boot(): { m: Machine; joy: JoystickBoard; sd: SdCardBoard; serial: number[] } {
  const m = buildMachine(defaultConfig('arcade'));
  m.loadRom(ROM);
  const sd = m.board<SdCardBoard>('sdcard')!;
  sd.card.insert(SD.slice());
  const serial: number[] = [];
  m.board<SerialBoard>('serial')!.acia.onTransmit = b => serial.push(b);
  m.powerOn();
  return { m, joy: m.board<JoystickBoard>('joystick')!, sd, serial };
}

export default async function () {
  // ---- the machine: miniVIC boards without the keyboard
  const { m, joy, sd, serial } = boot();
  assert(!m.board('keyboard'), 'the Arcade6502 has no keyboard');
  assert(m.vdu!.irqLine === 'nmi', 'VDP on NMI');
  assert(joy.base === 0xD580 && sd.base === 0xDD80, 'joystick $D580, SD $DD80');

  const t = waitFor(m, () => inList(m), 1500, 'front-end list');
  runFrames(m, 10);
  const list = rows(m);
  savePng(m, 'arcade_list');
  console.log(`      front-end list after ${(t / 60).toFixed(1)} s: ${list[2].trim()}`);
  assert(list[0].includes('ARCADE'), 'title bar: ' + list[0]);
  assert(String.fromCharCode(...serial).includes('MINIVIC ARCADE BIOS'), 'serial banner');

  // ---- 8-bit control panels and cabinet switches (active low on the pins)
  joy.setJoystick(0, JOY_FIRE3 | JOY_START);
  joy.setJoystick(1, JOY_START);
  assert(m.peek(0xD581) === 0x3F && m.peek(0xD580) === 0x7F, `ports: $${m.peek(0xD581).toString(16)} $${m.peek(0xD580).toString(16)}`);
  joy.setJoystick(0, 0);
  joy.setJoystick(1, 0);
  sd.setSwitches(SW_COIN1 | SW_COIN2);
  assert((m.peek(0xDD81) & 0xC0) === 0, 'coins on PA6/PA7');
  sd.setSwitches(0);
  assert((m.peek(0xDD81) & 0xE1) === 0xE1, 'switches released');
  // the miniVIC joystick board keeps 6 inputs
  const mv = buildMachine(defaultConfig('minivic')).board<JoystickBoard>('joystick')!;
  mv.setJoystick(0, JOY_FIRE3 | JOY_START | JOY_FIRE1);
  assert(mv.state[0] === JOY_FIRE1, 'miniVIC: buttons 3 and START not wired');

  // ---- a game from the front-end: DOWN, START (page), START (play)
  const press = (p1: number, p2 = 0) => {
    joy.setJoystick(0, p1); joy.setJoystick(1, p2); runFrames(m, 4);
    joy.setJoystick(0, 0); joy.setJoystick(1, 0); runFrames(m, 4);
  };
  press(JOY_DOWN);
  press(JOY_START);
  waitFor(m, () => rows(m)[15].includes('Inspired by'), 600, 'game page');
  const nameAt = (r: number, c: number) => m.vdu!.vdp.vram[((m.vdu!.vdp.reg[2] & 0x0F) << 10) + r * 32 + c];
  waitFor(m, () => nameAt(13, 23) === 128 + 95, 600, 'preview read from the SD');
  runFrames(m, 5);
  savePng(m, 'arcade_game_page');
  serial.length = 0;
  press(JOY_START);
  waitFor(m, () => String.fromCharCode(...serial).includes('[GAME] '), 1500, 'game started');
  const name = String.fromCharCode(...serial).match(/\[GAME\] ([^\r\n]+)/)![1];
  waitFor(m, () => m.cpu.pc < 0x8000, 600, 'game running');
  runFrames(m, 300);
  savePng(m, 'arcade_game');
  console.log(`      started from the front-end: ${name}`);

  // ---- both START held 2 s: back to the list
  joy.setJoystick(0, JOY_START); joy.setJoystick(1, JOY_START);
  runFrames(m, 130);
  joy.setJoystick(0, 0); joy.setJoystick(1, 0);
  waitFor(m, () => inList(m), 900, 'back to the front-end');

  // ---- TEST switch: the joystick test
  sd.setSwitches(SW_TEST); runFrames(m, 6); sd.setSwitches(0);
  waitFor(m, () => /TESTED/.test(rows(m).join('\n') + screenText(m)), 300, 'joystick test');
  savePng(m, 'arcade_joytest');

  // ---- a game loaded straight into RAM (Games panel): JSR JT_INIT_CRT returning to $1000
  const b = boot();
  waitFor(b.m, () => inList(b.m), 1500, 'front-end list (2)');
  const game = new Uint8Array(readFileSync(join(ROOT, 'public', 'games', 'bubbles.bin')));
  b.m.poke(0x0FD0, game);
  const cpu = b.m.cpu;
  b.m.poke(0x01FE, Uint8Array.of(0xFF, 0x0F));
  cpu.sp = 0xFD;
  cpu.p |= 0x04;
  cpu.pc = 0xFD09;
  runFrames(b.m, 2);
  assert(!g2(b.m) || cpu.pc < 0x8000, 'text mode set by JT_INIT_CRT');
  runFrames(b.m, 400);
  savePng(b.m, 'arcade_direct_game');
  assert(g2(b.m) && cpu.pc < 0x8000 || cpu.pc >= 0xA000, `game running (PC $${cpu.pc.toString(16)})`);
}
