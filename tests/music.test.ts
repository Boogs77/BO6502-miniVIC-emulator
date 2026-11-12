// Music panel: the MiniVIC Jukebox started like the panel does (KEYB/SD BIOS, full SD, joystick)
// must list the songs of src/machines/music.ts and, with fire on RANDOM PLAY, play them on the AYs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { APPS } from '../src/machines/apps';
import { JUKEBOX_FILE, SONGS } from '../src/machines/music';
import { GAME_ENTRY, GAME_LOAD } from '../src/machines/games';
import { extendSdImage } from '../src/machines/sdimage';
import { AudioBoard, JOY_FIRE1, JoystickBoard, SdCardBoard } from '../src/boards/Boards';
import { savePng, screenText, runFrames, assert } from './helpers';

export default async function () {
  const root = process.cwd();
  assert(APPS.some(a => a.file === JUKEBOX_FILE), `${JUKEBOX_FILE} is not in the Apps list`);
  assert(SONGS.length > 0, 'no songs in src/machines/music.ts');

  const m = buildMachine(defaultConfig('minivic'));
  m.loadRom(new Uint8Array(readFileSync(join(root, 'public', 'roms', 'minivic_keybsd.bin'))));
  m.board<SdCardBoard>('sdcard')!.card.insert(
    extendSdImage(new Uint8Array(gunzipSync(readFileSync(join(root, 'public', 'sd_full.img.gz'))))));
  m.powerOn();
  runFrames(m, 90);
  m.poke(GAME_LOAD, new Uint8Array(readFileSync(join(root, 'public', 'apps', JUKEBOX_FILE))));
  m.cpu.pc = GAME_ENTRY;
  m.cpu.sp = 0xFF;
  runFrames(m, 120);
  savePng(m, 'music_jukebox_list');

  // the Jukebox list shows short names in upper case (FUR ELISE, JINGLES): check the first word of the file name
  const text = screenText(m).toUpperCase();
  const missing = SONGS.filter(s => !text.includes(s.id.split('_')[0].toUpperCase()));
  assert(missing.length === 0, `songs not in the Jukebox list: ${missing.map(s => s.title).join(', ')}\n${text}`);

  // fire on the first entry (RANDOM PLAY): the AYs must play (some channel with volume or envelope)
  const joy = m.board<JoystickBoard>('joystick')!;
  joy.setJoystick(0, JOY_FIRE1);
  runFrames(m, 6);
  joy.setJoystick(0, 0);
  runFrames(m, 120);
  savePng(m, 'music_jukebox_play');
  const audio = m.board<AudioBoard>('audio')!;
  const loud = [audio.left, audio.right].some(ay => [8, 9, 10].some(r => (ay.regs[r] & 0x1F) !== 0));
  assert(loud, 'the Jukebox does not play: all AY volumes are 0');
  console.log(`      Jukebox: ${SONGS.length} songs, all in its list, random play playing`);
}
