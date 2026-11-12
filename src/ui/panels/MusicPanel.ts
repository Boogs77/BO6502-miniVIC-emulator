// Music panel: the songs of MiniVIC Sound, played by the MiniVIC Jukebox
// The songs are not started one by one: the button starts the Jukebox (like the Apps panel, KEYB/SD BIOS,
// keys on the joystick) and the song is chosen in its list with joystick 1; the list here is information only.

import { Emulator } from '../../app/Emulator';
import { JUKEBOX_FILE, SONGS } from '../../machines/music';
import { h } from '../dom';

const time = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function musicPanel(emu: Emulator): HTMLElement {
  const play = h('button', {
    class: 'primary jukebox-play', type: 'button',
    onclick: () => emu.runApp(JUKEBOX_FILE).catch(err => emu.onMessage(String(err), 'error')),
  }, '▶ Start the MiniVIC Jukebox');

  const list = h('ol', { class: 'songs' });
  SONGS.forEach((s, i) => list.append(h('li', { class: 'song' },
    h('span', { class: 'game-n' }, String(i + 1)),
    h('span', { class: 'game-title' }, s.title),
    h('span', { class: 'game-players' }, time(s.seconds)),
    h('span', { class: 'app-desc' }, s.composer))));

  const total = SONGS.reduce((t, s) => t + s.seconds, 0);
  return h('div', { class: 'panel-body' },
    h('p', { class: 'hint' },
      `The ${SONGS.length} songs of MiniVIC Sound (${time(total)} in all), in stereo on the two AY-3-8910: `,
      'public domain classics and original tunes in the 1980s style. They are played by the MiniVIC Jukebox: ',
      'the button loads it into RAM at $0FD0 and starts it; choose the song in its list with joystick 1. ',
      'It is also on the full SD card: BIOS menu 3.'),
    play,
    list,
    h('div', { class: 'keys-help' },
      h('div', {}, h('b', {}, 'Up / down'), ' choose a song (↑ ↓)'),
      h('div', {}, h('b', {}, 'Fire'), ' play it (Z or Space); in a song: back to the list; on RANDOM PLAY: every song in random order'),
      h('div', {}, h('b', {}, 'Right / left'), ' next song / play it again'),
      h('div', {}, h('b', {}, 'Exit'), ' fire on EXIT: back to the BIOS menu')),
  );
}
