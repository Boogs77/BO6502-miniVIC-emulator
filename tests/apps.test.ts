// All the miniVIC applications: loaded after the KEYB/SD BIOS with the full SD (like the Apps panel)
// they must start and draw their screen; DISK must also read the program directory of the SD
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { APPS } from '../src/machines/apps';
import { GAME_ENTRY, GAME_LOAD } from '../src/machines/games';
import { extendSdImage } from '../src/machines/sdimage';
import { SdCardBoard } from '../src/boards/Boards';
import { savePng, screenText, runFrames, assert } from './helpers';

export default async function () {
  const root = process.cwd();
  const rom = new Uint8Array(readFileSync(join(root, 'public', 'roms', 'minivic_keybsd.bin')));
  const sd = extendSdImage(new Uint8Array(gunzipSync(readFileSync(join(root, 'public', 'sd_full.img.gz')))));
  for (const a of APPS) {
    const m = buildMachine(defaultConfig('minivic'));
    m.loadRom(rom);
    m.board<SdCardBoard>('sdcard')!.card.insert(sd.slice());
    m.powerOn();
    runFrames(m, 90);
    m.poke(GAME_LOAD, new Uint8Array(readFileSync(join(root, 'public', 'apps', a.file))));
    m.cpu.pc = GAME_ENTRY;
    m.cpu.sp = 0xFF;
    runFrames(m, 300);
    savePng(m, 'app_' + a.file.replace('.bin', ''));
    const text = screenText(m);
    assert(text.replace(/\s/g, '').length >= 20, `${a.title}: empty screen\n${text}`);
    if (a.file === 'disk.bin') assert(/ASTEROIDS/.test(text), `${a.title}: SD programs not listed\n${text}`);
  }
  console.log(`      ${APPS.length} applications started`);
}
