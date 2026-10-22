// Giochi miniVIC: avvio diretto in RAM oppure dal menu SD del BIOS

import { Emulator } from '../../app/Emulator';
import { GAMES } from '../../machines/games';
import { h } from '../dom';

export function gamesPanel(emu: Emulator): HTMLElement {
  const list = h('div', { class: 'games' });
  GAMES.forEach((g, i) => {
    list.append(h('button', {
      class: 'game', type: 'button',
      onclick: () => {
        if (emu.machineId !== 'minivic') emu.selectMachine('minivic');
        emu.runGame(g.file).catch(err => emu.onMessage(String(err), 'error'));
      },
    },
    h('span', { class: 'game-n' }, String(i + 1)),
    h('span', { class: 'game-title' }, g.title),
    h('span', { class: 'game-players' }, `${g.players} gioc.`)));
  });
  return h('div', { class: 'panel-body' },
    h('p', { class: 'hint' },
      'Giochi arcade del miniVIC (TMS9918A + 2x AY-3-8910). Il clic carica il gioco in RAM a $0FD0 e lo avvia; ',
      'i comandi passano ai joystick. Sono anche sulla SD inserita: menu 3 del BIOS.'),
    list,
    h('div', { class: 'keys-help' },
      h('div', {}, h('b', {}, 'Joystick 1'), ' frecce · Z / Spazio = 1 · X = 2'),
      h('div', {}, h('b', {}, 'Joystick 2'), ' W A S D · F = 1 · G = 2'),
      h('div', {}, h('b', {}, 'Gamepad'), ' il primo e il secondo collegati')),
  );
}
