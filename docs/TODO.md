# 📋 To do

Next steps for the BO6502 · miniVIC emulator, in order of priority.
Undocumented hardware behaviour is asked to the user, not invented.

---

## 🎵 Music tab (done 2026-11-12)

- Done: the **Music** tab starts the MiniVIC Jukebox (the only player, it contains all the songs) and lists the
  songs from the README of miniVIC_music (`scripts/sync-music.mjs`, daily workflow, `tests/music.test.ts`).
- Open point: start the Jukebox on a chosen song (needs an entry point or a parameter in the Jukebox, miniVIC_music).

## 🕹️ 1. Third machine: Arcade

A third machine next to BO6502 and miniVIC, based on the BO6502: practically identical to the miniVIC but
**without the keyboard**, so it can also be used to build a real cabinet.
- Hardware: CPU, RAM/ROM, VDU (CRT screen only, no other displays), audio, SD as on the miniVIC;
  **two joysticks with 5 buttons each**: button 1, button 2, button 3, **coin** and **start** (player 1 / player 2).
- User interface: CRT screen and two arcade control panels (stick + buttons 1-3, coin, start), no virtual keyboard;
  physical keys and gamepads mapped to the 5 buttons.
- Open points to ask the user (do not guess):
  - joystick board: address and bit of each of the 5 buttons (the current board has only bits 0-5:
    4 directions + buttons 1-2, so 4 directions + 5 buttons need 9 lines per player: where do
    button 3, coin and start go?);
  - addresses of the other boards (same as the miniVIC?), VDP INT line (NMI as on the miniVIC?);
  - BIOS/ROM: which one, and what coin/start do outside the games;
  - is the serial port present?
  - which games/programs run on it (the miniVIC games unchanged?).
- **Front-end** to start the games, driven by the joystick:
  - a scrolling list with the game names;
  - a second view with a preview of the game and a description, also naming the game that inspired it;
  - MiniVIC Sound / MiniVIC Jukebox is an entry of the front-end too: selecting it starts the Jukebox
    (the songs are played only through the Jukebox, as in the Music tab).
  - It is a **6502 program** that runs on the real cabinet, part of a **new Arcade version of the BIOS**,
    developed in the BIOS repository (github.com/Boogs77/miniVIC_bios, local `../miniVIC BIOS`), not here.
    The emulator gets it like the other BIOS images (`scripts/sync-bios.mjs`) and adds it to the ROM choice.
  - Previews: the title screens of the games (the ones the games test already captures), converted for the
    TMS9918 and stored on the SD; descriptions: from the table of the games README (miniVIC_games).
    The SD builder (bo6502-SDbuilder) must write previews and descriptions on the SD in a format the BIOS reads.

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
