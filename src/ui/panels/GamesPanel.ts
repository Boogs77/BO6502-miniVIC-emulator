// miniVIC games: direct start in RAM or from the BIOS SD menu (on the Arcade6502: from the front-end)

import { Emulator } from '../../app/Emulator';
import { GAMES } from '../../machines/games';
import { h } from '../dom';

export function gamesPanel(emu: Emulator): HTMLElement {
  const list = h('div', { class: 'games' });
  GAMES.forEach((g, i) => {
    list.append(h('button', {
      class: 'game', type: 'button',
      onclick: async () => {
        // the Arcade6502 runs the miniVIC games unchanged; the BO6502 switches to the miniVIC
        if (emu.machineId === 'bo6502') await emu.selectMachine('minivic');
        emu.runGame(g.file).catch(err => emu.onMessage(String(err), 'error'));
      },
    },
    h('span', { class: 'game-n' }, String(i + 1)),
    h('span', { class: 'game-title' }, g.title),
    h('span', { class: 'game-players' }, `${g.players} ${g.players === '1' ? 'player' : 'players'}`)));
  });
  return h('div', { class: 'panel-body' },
    h('p', { class: 'hint' },
      'miniVIC arcade games (TMS9918A + 2x AY-3-8910). A click loads the game into RAM at $0FD0 and starts it; ',
      'the keys switch to the joysticks. They are also on the inserted SD card: BIOS menu 3 (on the Arcade6502: the front-end list).'),
    list,
    h('div', { class: 'keys-help' },
      h('div', {}, h('b', {}, 'Joystick 1'), ' arrows · Z / Space = 1 · X = 2'),
      h('div', {}, h('b', {}, 'Joystick 2'), ' W A S D · F = 1 · G = 2'),
      h('div', {}, h('b', {}, 'Gamepad'), ' the first and second connected'),
      h('div', {}, h('b', {}, 'Arcade6502'), ' C / H = 3 · 1 / 2 = START · 5 / 6 = COIN · 9 SERVICE · 0 TEST · both START 2 s: back to the list')),
  );
}
