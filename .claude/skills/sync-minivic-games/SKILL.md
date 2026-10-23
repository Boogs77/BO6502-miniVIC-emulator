---
name: sync-minivic-games
description: Updates the BO6502/miniVIC emulator games with the ones of the miniVIC_games project ("MiniVIC Games" folder or github.com/Boogs77/miniVIC_games) - copies new or changed .bin files into public/games, regenerates src/machines/games.ts, checks that every game reaches its title screen and publishes (GitHub Pages site). Always use it when the session-start notice says there are games to sync, when the user says they finished, published or updated a miniVIC game, that there are new games, or asks to update/align/import the games into the emulator or the online site, even without naming the skill.
---

# Syncing the miniVIC games into the emulator

The games project (`miniVIC_games`) and the emulator live in two repositories. Every game published
there must also arrive here: in `public/games/<game>.bin` (loaded at `$0FD0`, started at `$1000`) and in
the `GAMES` list of `src/machines/games.ts`, which drives the Games panel, the default SD card and the
boot test.

`scripts/sync-games.mjs` does the mechanical work; you verify and publish.

## 1. Check what changed

```bash
node scripts/sync-games.mjs --check
```

- Source: the `../MiniVIC Games` folder next to the repository (or `MINIVIC_GAMES_DIR`); if it is not
  there, add `--github` to read from GitHub. The local folder may hold games not published yet:
  if the user only wants the published ones, use `--github`.
- Titles and player counts come from the table in the games README; the order is the README order.
- Exit 0 = already in sync: tell the user and stop. Exit 2 = differences: go on.

## 2. Apply

```bash
node scripts/sync-games.mjs
```

The script copies the new or changed `.bin` files and rewrites `games.ts`. It does not remove games
missing from the source (it lists them as "only in the emulator"): use `--prune` only if the user
really wants them removed, because a game missing from the local folder may just be a moved file.

## 3. Check that the games start

```bash
npx tsc --noEmit
npm test -- games
```

`tests/games.test.ts` starts every game in the list after the BIOS and saves
`tests/out/title_<game>.png`. Look at the images of the new or updated games with Read: the title
screen must be visible. An empty or corrupted image is usually not an emulator bug but a game bug
(for example NMI variables read before being initialised, see "RAM at power-on" in CLAUDE.md):
report it to the user with the game and the address instead of hiding it, and do not publish that
game without asking.

If the games repository has `screenshots/<game>_title.png`, compare it with yours: it is produced by
`tools/minivic.js`, the reference emulator.

## 4. Publish

The user asked for the games to update by themselves on the site too, so once the checks pass
commit and push (the Pages workflow republishes the site in about a minute):

```bash
git add public/games src/machines/games.ts
git commit -m "Sync miniVIC games: <new or updated games>"
git push
```

Commit message in English, like the others in the repository, with the required Co-Authored-By line.
If the push fails or the tests do not pass, do not force anything: explain what happened.

## 5. Report

In Italian (the user's language), briefly: games added/updated (title and players), test results,
link to the site https://boogs77.github.io/BO6502-miniVIC-emulator/ and any problem found in the games.

## Existing automation

- `SessionStart` hook in `.claude/settings.json`: at the start of a session it runs
  `node scripts/sync-games.mjs --check --hook` and, if there is news, adds a notice to the context.
  When you see it, propose (or run, if the user already asked to keep them aligned) this skill.
- `.github/workflows/sync-games.yml` workflow: every day it checks github.com/Boogs77/miniVIC_games and,
  if there are new games, adds them, runs the boot test and republishes the site, even without Claude.
