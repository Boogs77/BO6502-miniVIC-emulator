# 📋 To do

Next steps for the BO6502 · miniVIC emulator, in order of priority.
Undocumented hardware behaviour is asked to the user, not invented.

---

## 🎵 Music tab (done 2026-11-12)

- Done: the **Music** tab starts the MiniVIC Jukebox (the only player, it contains all the songs) and lists the
  songs from the README of miniVIC_music (`scripts/sync-music.mjs`, daily workflow, `tests/music.test.ts`).
- Open point: start the Jukebox on a chosen song (needs an entry point or a parameter in the Jukebox, miniVIC_music).

## 🕹️ Third machine: Arcade6502 (done 2026-11-13)

The miniVIC cabinet without the keyboard (schematic `Arcade6502.sch`, Arcade BIOS project `../Arcade BIOS`,
github.com/Boogs77/arcade_bios, private). Done: profile `arcade` (miniVIC addresses, VDP on NMI, serial port, no
keyboard), 8-bit joystick ports (button 3, START), TEST / SERVICE / COIN 1 / COIN 2 on the SD VIA, two control panels
and the cabinet switches on screen, keys and gamepads, Arcade BIOS 12.11.26 by default (`scripts/sync-bios.mjs`),
cabinet SD `sd_arcade.img.gz` by default, Games / Music panels running on it, `tests/arcade.test.ts`.
The front-end (list, gallery, game pages, tests, Jukebox entry) is in the Arcade BIOS.
- Later (user's decision 2026-11-13): coin and START inside the games, button 3; the games will be changed for it.
- The daily workflow cannot read the private arcade_bios repository: `public/roms/arcade.bin` is updated by running
  `node scripts/sync-bios.mjs` locally (or by giving the workflow a token, `ARCADE_BIOS_TOKEN`).

---

## 🔧 Hardware still to emulate
- Keyboard of the legacy LCD board.
- Monitor board (Arduino Mega sniffer).

## 🖥️ Displays
- T6963C: text attribute mode, screen peek/copy, 6x8 font (FS = 1).
- HD44780: real busy timings, Japanese A00 CGROM.

## 📐 To check on the schematics (with the user)
- AY register reads.
- BO6502 audio board decoding: the module README says A0 = BC1, A1 = BDIR, A2 = 0 left, different from the miniVIC
  (decision 2026-10-23: same decoding as the miniVIC for now).
- IRQ line of ACIA/VIA.
- Legacy LCD '8bit' wiring (RS/RW/E on PA5/PA6/PA7 is a Ben Eater style guess).

## ⚙️ Emulator features
- Save/restore state.
- TMS VRAM timing (accesses too close together).
- KEYB/SD: automatic BIOS choice per program and a `?bios=` URL parameter (left out on purpose, 2026-10-27).

## 🎮 Games (to report to the games project, not to fix here)
- Variables read before being initialised when the NMI fires at once: `centipede.asm` (`QGO` $79),
  `the_warriors.asm` (`SAT_BUFFER` $0260), `asteroids.asm` (`WAVE` $91). Fix: initialise the NMI variables
  (or read VREG) before enabling the INT.

## 🔄 Sync and infrastructure
- Optional: start the games sync at once from miniVIC_games (`repository_dispatch`, needs a token).

---

*Created by Boogs77 - 2026*
