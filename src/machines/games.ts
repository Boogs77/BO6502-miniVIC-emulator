// Giochi miniVIC inclusi (public/games, da github.com/Boogs77/miniVIC_games)
// Ogni .bin parte da $0FD0 (trampolino NMI) e il programma da $1000.

export interface GameInfo {
  file: string;
  title: string;
  players: string;
}

export const GAMES: GameInfo[] = [
  { file: 'tank.bin', title: 'Tank vs Tank', players: '2' },
  { file: '1vs1.bin', title: '1 vs 1 Basketball', players: '2' },
  { file: 'centipede.bin', title: 'Centipede', players: '1' },
  { file: 'missile_command.bin', title: 'Missile Command', players: '1-2' },
  { file: 'lunar_lander.bin', title: 'Lunar Lander', players: '1' },
  { file: 'the_warriors.bin', title: 'The Warriors', players: '2' },
  { file: 'breakout.bin', title: 'Breakout', players: '1' },
  { file: 'asteroids.bin', title: 'Asteroids', players: '1' },
];

export const GAME_LOAD = 0x0FD0;
export const GAME_ENTRY = 0x1000;
