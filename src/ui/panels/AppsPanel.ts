// miniVIC applications (MiniVIC Apps): direct start in RAM with the KEYB/SD BIOS, or from the BIOS SD menu

import { Emulator } from '../../app/Emulator';
import { APPS } from '../../machines/apps';
import { h } from '../dom';

export function appsPanel(emu: Emulator): HTMLElement {
  const list = h('div', { class: 'games' });
  APPS.forEach((a, i) => {
    list.append(h('button', {
      class: 'game', type: 'button', title: a.description,
      onclick: () => emu.runApp(a.file).catch(err => emu.onMessage(String(err), 'error')),
    },
    h('span', { class: 'game-n' }, String(i + 1)),
    h('span', { class: 'game-title' }, a.title),
    h('span', { class: 'game-players' }, a.type),
    h('span', { class: 'app-desc' }, a.description)));
  });
  return h('div', { class: 'panel-body' },
    h('p', { class: 'hint' },
      'miniVIC office applications (TMS9918A text mode, PS/2 keyboard, SD documents). A click loads the app into RAM ',
      'at $0FD0 and starts it with the KEYB/SD BIOS; the keys switch to the keyboard. They are also on the full SD card: BIOS menu 3.'),
    list,
    h('div', { class: 'keys-help' },
      h('div', {}, h('b', {}, 'Ctrl'), ' ^K S = Ctrl+K, then S'),
      h('div', {}, h('b', {}, 'Help'), ' F1 or ^J'),
      h('div', {}, h('b', {}, 'Quit'), ' F10, ^K Q or Q: back to the BIOS menu')),
  );
}
