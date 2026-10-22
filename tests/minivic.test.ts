// miniVIC con il BIOS reale: menu di avvio, menu SD, caricamento ed esecuzione di un gioco
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { buildSdImage } from '../src/machines/sdimage';
import { SdCardBoard } from '../src/boards/Boards';
import { savePng, screenText, runFrames, tap, assert } from './helpers';

const ROOT = process.cwd();

export default async function () {
  const m = buildMachine(defaultConfig('minivic'));
  m.loadRom(new Uint8Array(readFileSync(join(ROOT, 'public', 'roms', 'minivic.bin'))));

  const games = readdirSync(join(ROOT, 'public', 'games')).filter(f => f.endsWith('.bin')).sort();
  const sd = buildSdImage(games.map(f => ({
    name: f.replace(/\.bin$/, '').replace(/_/g, ' '),
    data: new Uint8Array(readFileSync(join(ROOT, 'public', 'games', f))),
    load: 0x0FD0, entry: 0x1000, run: true,
  })));
  m.board<SdCardBoard>('sdcard')!.card.insert(sd);

  m.powerOn();
  runFrames(m, 90);
  const menu = screenText(m);
  savePng(m, 'minivic_menu');
  assert(menu.includes('SDCARD PROGRAMS MENU'), 'menu di avvio non trovato:\n' + menu);

  tap(m, 'Digit3');
  runFrames(m, 120);
  const sdMenu = screenText(m);
  savePng(m, 'minivic_sdmenu');
  assert(sdMenu.includes('SD PROGRAMS MENU'), 'menu SD non trovato:\n' + sdMenu);
  console.log(sdMenu.split('\n').filter(l => l.trim()).map(l => '      | ' + l).join('\n'));

  // primo gioco in ordine alfabetico: 1vs1
  tap(m, 'Digit1');
  let t = 0;
  while (m.cpu.pc >= 0x8000 && t < 1200) { runFrames(m, 10); t += 10; }
  console.log(`      caricamento dalla SD: ${(t / 60).toFixed(1)} s emulati`);
  m.audio.take();
  runFrames(m, 240);
  savePng(m, 'minivic_game_title');
  const samples = m.audio.take();
  let energy = 0;
  for (const s of samples) energy += s * s;
  console.log(`      PC=$${m.cpu.pc.toString(16)} frame=${m.frame} campioni audio=${samples.length} energia=${energy.toFixed(1)}`);
  assert(m.vdu!.vdp.reg[0] & 0x02, 'il gioco non ha attivato Graphics II');
  assert(energy > 0, 'nessun suono dalla musica del titolo');
}
