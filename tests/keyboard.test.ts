// PS/2 keyboard with the real miniVIC BIOS: the release of a menu key (F0 + code) that
// arrives during FLUSH_KEYBOARD_HARD must be dropped, not read as a new key press
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { KeyboardBoard } from '../src/boards/Boards';
import { screenText, runFrames, assert } from './helpers';

function pressInMenu(code: string, holdFrames: number): string {
  const m = buildMachine(defaultConfig('minivic'));
  m.loadRom(new Uint8Array(readFileSync(join(process.cwd(), 'public', 'roms', 'minivic.bin'))));
  m.powerOn();
  runFrames(m, 90);
  const kb = m.board<KeyboardBoard>('keyboard')!.keyboard;
  kb.keyDown(code);
  runFrames(m, holdFrames);
  kb.keyUp(code);
  runFrames(m, 120);
  return screenText(m);
}

export default async function () {
  for (const hold of [1, 4, 8, 12]) {
    const woz = pressInMenu('Digit1', hold).split('\n').filter(l => l.trim());
    assert(woz.length === 1 && woz[0].trim() === '\\', `WozMon after '1' held ${hold} frames:\n${woz.join('\n')}`);
    const info = pressInMenu('Digit4', hold);
    assert(info.includes('SYSTEM INFORMATION'), `info page after '4' held ${hold} frames:\n${info}`);
  }
}
