---
name: sync-minivic-games
description: Aggiorna i giochi dell'emulatore BO6502/miniVIC con quelli del progetto miniVIC_games (cartella "MiniVIC Games" o github.com/Boogs77/miniVIC_games) - copia i .bin nuovi o cambiati in public/games, rigenera src/machines/games.ts, verifica che ogni gioco arrivi al titolo e pubblica (sito GitHub Pages). Usala sempre quando l'avviso di inizio sessione dice che ci sono giochi da sincronizzare, quando l'utente dice che ha finito, pubblicato o aggiornato un gioco del miniVIC, che ci sono giochi nuovi, o chiede di aggiornare/allineare/importare i giochi nell'emulatore o nel sito online, anche senza nominare la skill.
---

# Sincronizzare i giochi del miniVIC nell'emulatore

Il progetto dei giochi (`miniVIC_games`) e l'emulatore vivono in due repository. Ogni gioco pubblicato la'
deve arrivare anche qui: in `public/games/<gioco>.bin` (caricato a `$0FD0`, avvio a `$1000`) e nell'elenco
`GAMES` di `src/machines/games.ts`, da cui nascono il pannello Giochi, la SD predefinita e il test di avvio.

Il lavoro meccanico lo fa `scripts/sync-games.mjs`; tu verifichi e pubblichi.

## 1. Controlla cosa e' cambiato

```bash
node scripts/sync-games.mjs --check
```

- Sorgente: la cartella `../MiniVIC Games` accanto al repository (o `MINIVIC_GAMES_DIR`); se non c'e',
  aggiungi `--github` per leggere da GitHub. La cartella locale puo' avere giochi non ancora pubblicati:
  se l'utente vuole solo quelli pubblicati, usa `--github`.
- Titoli e numero di giocatori vengono dalla tabella del README dei giochi; l'ordine e' quello del README.
- Exit 0 = gia' allineati: dillo all'utente e fermati. Exit 2 = differenze: prosegui.

## 2. Applica

```bash
node scripts/sync-games.mjs
```

Lo script copia i `.bin` nuovi o cambiati e riscrive `games.ts`. Non toglie giochi che mancano nella
sorgente (li segnala come "solo nell'emulatore"): usa `--prune` solo se l'utente vuole davvero toglierli,
perche' un gioco sparito dalla cartella locale puo' essere solo un file spostato.

## 3. Verifica che i giochi partano

```bash
npx tsc --noEmit
npm test -- games
```

`tests/games.test.ts` avvia ogni gioco dell'elenco dopo il BIOS e salva `tests/out/title_<gioco>.png`.
Guarda le immagini dei giochi nuovi o aggiornati con Read: deve vedersi la schermata del titolo.
Un'immagine vuota o rovinata di solito non e' un errore dell'emulatore ma del gioco (per esempio variabili
dell'NMI lette prima di essere inizializzate, vedi "RAM all'accensione" in CLAUDE.md): riportalo
all'utente con il gioco e l'indirizzo, invece di nasconderlo, e non pubblicare quel gioco senza chiedere.

Se nel repository dei giochi c'e' `screenshots/<gioco>_title.png`, confrontala con la tua: e' prodotta da
`tools/minivic.js`, l'emulatore di riferimento.

## 4. Pubblica

L'utente ha chiesto che i giochi si aggiornino da soli anche sul sito, quindi a verifica superata fai
commit e push (il workflow Pages ripubblica il sito in circa un minuto):

```bash
git add public/games src/machines/games.ts
git commit -m "Sync miniVIC games: <giochi nuovi o aggiornati>"
git push
```

Messaggio di commit in inglese, come gli altri del repository, con la riga Co-Authored-By prevista.
Se il push fallisce o i test non passano, non forzare: spiega cosa e' successo.

## 5. Riferisci

In italiano, breve: giochi aggiunti/aggiornati (titolo e giocatori), esito dei test, link al sito
https://boogs77.github.io/BO6502-miniVIC-emulator/ e qualunque problema trovato nei giochi.

## Automatismi gia' presenti

- Hook `SessionStart` in `.claude/settings.json`: all'avvio di una sessione esegue
  `node scripts/sync-games.mjs --check --hook` e, se ci sono novita', aggiunge un avviso al contesto.
  Quando lo vedi, proponi (o esegui, se l'utente ha gia' chiesto di tenerli allineati) questa skill.
- Workflow `.github/workflows/sync-games.yml`: ogni giorno controlla github.com/Boogs77/miniVIC_games e,
  se ci sono giochi nuovi, li aggiunge, esegue il test di avvio e ripubblica il sito, anche senza Claude.
