// Tutti i giochi miniVIC: caricati dopo il BIOS (come il pannello Giochi) devono arrivare al titolo
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMachine, defaultConfig } from '../src/machines/profiles';
import { GAMES, GAME_ENTRY, GAME_LOAD } from '../src/machines/games';
import { savePng, runFrames, assert } from './helpers';

export default async function () {
  const rom = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'roms', 'minivic.bin')));
  for (const g of GAMES) {
    const m = buildMachine(defaultConfig('minivic'));
    m.loadRom(rom);
    m.powerOn();
    runFrames(m, 60);
    m.poke(GAME_LOAD, new Uint8Array(readFileSync(join(process.cwd(), 'public', 'games', g.file))));
    m.cpu.pc = GAME_ENTRY;
    m.cpu.sp = 0xFF;
    runFrames(m, 450);
    savePng(m, 'title_' + g.file.replace('.bin', ''));
    const colors = new Set(m.vdu!.vdp.frame);
    assert(colors.size >= 3, `${g.title}: schermata del titolo vuota (${colors.size} colori)`);
  }
}
