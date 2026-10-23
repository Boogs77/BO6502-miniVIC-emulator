# BO6502 · miniVIC Emulator – istruzioni per Claude

Emulatore web (TypeScript + Vite, nessuna dipendenza a runtime) di due computer 65C02 di Boogs77:
- **BO6502**: computer modulare su backplane a 39 pin — https://github.com/Boogs77/BO6502_65C02-based_modular_computer
- **miniVIC**: la versione compatta per i giochi — giochi in https://github.com/Boogs77/miniVIC_games

Repository: https://github.com/Boogs77/BO6502-miniVIC-emulator
Online (GitHub Pages, deploy automatico a ogni push su main): https://boogs77.github.io/BO6502-miniVIC-emulator/

## Lingua e stile
- Rispondi all'utente in **italiano**. Commenti nel codice e testi dell'interfaccia in italiano.
- README e messaggi di commit in **inglese**, nello stile dei repository di Boogs77 (sezioni con emoji, separatori `---`, firma *Created by Boogs77 - 2026*).
- Codice: classi piccole, commento d'intestazione in ogni file che spiega cosa emula e come; niente dipendenze npm a runtime.
- `tsconfig` ha `erasableSyntaxOnly`: **niente `enum` e niente parameter properties** (`constructor(private x)`); `noUnusedLocals/Parameters` attivi.

## Comandi
| Comando | Cosa fa |
| :--- | :--- |
| `npm run dev` | server di sviluppo (http://localhost:5173) |
| `npm run build` | typecheck + build statica in `dist/` (base relativa, va bene per GitHub Pages) |
| `npm run typecheck` | solo `tsc --noEmit` |
| `npm test` | test Node (esbuild): CPU, chip, sistema completo; `npm test -- minivic` per filtrare |

I test scrivono gli screenshot in `tests/out/*.png` (ignorati da git): **guardali** quando tocchi il video.
Le suite CPU di Klaus Dormann (GPL) si scaricano da sole in `tests/fixtures/klaus/` (ignorata da git).

## Struttura
```
src/
  cpu/W65C02.ts         CPU: set WDC 65C02 completo + Rockwell (RMB/SMB/BBR/BBS), WAI/STP, NOP non documentati,
                        cicli esatti (pagina, branch, +1 decimale), IRQ a livello, NMI sul fronte
  cpu/disasm.ts         disassemblatore per il debugger
  devices/TMS9918A.ts   VDP: rendering per riga, tutti i modi (G1, G2, Multicolor, Text, + combinazioni M3),
                        sprite 8/16 + ingranditi, limite 4 per riga, flag 5S + numero, collisione, early clock,
                        latch/read-ahead come il chip reale, F a fine riga 191, INT se R1 bit 5
  devices/AY38910.ts    PSG a livello di contatori (tick = clock/8): toni 12 bit, rumore LFSR 17 bit,
                        16 forme d'inviluppo, mixer R7, tabella volumi logaritmica misurata
  devices/VIA6522.ts    W65C22: porte/DDR, CA1/CB1 con PCR, T1 one-shot/free-run (PB7), T2, IFR/IER, IRQ
  devices/ACIA6551.ts   W65C51: TX immediato (TDRE sempre 1), coda RX, IRQ RX
  devices/SDCard.ts     SD in SPI (SDSC, indirizzi a byte): CMD0/8/12/16/17/24/55/58 + ACMD41
  devices/KeyboardPS2.ts scancode set 2 grezzi (E0, F0) sulla porta A + impulso su CA1
  devices/T6963.ts      T6963C: comandi con parametri, auto write/read, OR/EXOR/AND, testo+grafica, CG RAM, cursore
  devices/HD44780.ts    HD44780U: 8/4 bit (nibble su E in discesa), DDRAM 2 righe, CGRAM, shift, lettura BF/AC/dati
  devices/font5x8.ts    font 5x8 ASCII estratto da VDP_PATTERNS del BIOS (crt_text_drv.s), usato dagli LCD
  boards/Boards.ts      schede: VduBoard, SerialBoard, KeyboardBoard, JoystickBoard, SdCardBoard, AudioBoard, BaseBoard
  boards/DisplayBoards.ts BigLcdBoard (T6963), LcdBoard (HD44780, cablaggio 4bit/8bit), LedBoard (16 LED)
  core/Board.ts         interfaccia delle schede (base, size, irqLine, read/write/peek, tick, endFrame)
  core/Machine.ts       bus a blocchi di 16 byte, RAM/ROM, buchi ROM $B000-$DFFF, linee IRQ (wired-OR) e NMI
                        (fronte), frame NTSC da 262 righe, breakpoint
  machines/profiles.ts  configurazioni BO6502 / miniVIC, BOARD_INFO, buildMachine()
  machines/sdimage.ts   immagine SD formato make_sd.py (directory "BOGS" v3 a pagine)
  machines/games.ts     elenco dei giochi in public/games
  audio/StereoSink.ts   media dei tick PSG -> frequenza d'uscita, passa-alto 20 Hz (condensatori LM386)
  audio/AudioOutput.ts  AudioWorklet (da Blob) con coda; riporta i campioni in coda per agganciare il ritmo
  app/Emulator.ts       controller: macchina, accensione, ciclo RAF agganciato all'audio, input, caricamenti
  app/settings.ts       impostazioni in localStorage (sempre in try/catch)
  ui/                   App (layout), Screen, Displays (Big LCD, LCD 16x2, LED), Terminal + TerminalModel,
                        VirtualKeyboard, Joypad, panels/*
public/demos/*.bin      demo delle schede (sorgenti in tests/fixtures/asm, assemblati con vasm)
.github/workflows/pages.yml  build e deploy su GitHub Pages
public/roms/minivic.bin BIOS miniVIC 30.09.26 (WozMon + MS BASIC 1977 + menu SD) - ROM predefinita
public/games/*.bin      giochi miniVIC (caricati a $0FD0, avvio a $1000)
tests/                  run.mjs (runner), cpu/devices/displays/games/minivic.test.ts, helpers.ts (PNG, testo, tasti)
_old/                   vecchio emulatore (non in git)
```

## Le due macchine
Hardware comune: W65C02S, RAM 32 KB `$0000-$7FFF`, ROM 32 KB `$8000-$FFFF` (con le pagine di I/O
`$B000-$DFFF` escluse, come la ROM multi con J-CS3/4/5 su VCC), VDU, seriale, tastiera, joystick, SD, audio.

| Scheda | Chip | BO6502 | miniVIC |
| :--- | :--- | :--- | :--- |
| VDU | TMS9918A (A0: 0 dati, 1 registri/stato) | `$B000`, INT → **IRQ** | `$B000`, INT → **NMI** |
| Serial I/O | W65C51 (`$x000` dati, `+1` stato, `+2` comando, `+3` controllo) | `$C000` | `$C000` |
| KEYb | W65C22 + PS/2 (porta A = scancode, CA1 = KB_INT) | `$D180` | `$D180` |
| Joystick | W65C22 (PA = P1, PB = P2, attivi bassi) | `$D1A0` | `$D580` |
| SD Card | W65C22 (PA1 MISO, PA2 MOSI, PA3 SCK, PA4 CS) | `$D1B0` | `$DD80` |
| Audio | 2x AY-3-8910 (A0: 0 latch, 1 dato; A2: 0 destro, 1 sinistro) | `$D1C0` | `$D380` |
| Big LCD | W65C22 + T6963C 160x128 (PB dati; PA0 /RD, PA1 /WR, PA2 /CE, PA3 C/D, PA4 /HALT, PA5 /RST) | `$D190` | — |
| LCD legacy | W65C22 + HD44780 16x2, decodifica tutta `$Dxxx` (spenta di default) | `$D000` | — |
| LED test | W65C22, 16 LED (PA, PB; acceso = uscita a 1), decodifica tutta `$Dxxx` (spenta di default) | `$D000` | — |

- Il BO6502 è configurabile nel rack (schede, indirizzi, linea INT, clock 0,5/1/2 MHz) **solo a macchina spenta**; il miniVIC è fisso.
- Joystick: bit 0 su, 1 giù, 2 sinistra, 3 destra, 4 tasto 1, 5 tasto 2 (0 = premuto sui pin).
- Clock dei PSG = clock della CPU (1 MHz: periodo = 1.000.000 / (16 × f)).
- **Decisione 2026-10-23**: la scheda audio del BO6502 usa la stessa decodifica del miniVIC (solo l'indirizzo cambia);
  il README del modulo AUDIO (A0 = BC1, A1 = BDIR, A2 = 0 sinistro) va verificato e corretto dopo con l'utente.
- LCD legacy: cablaggio '4bit' = `lcd.s` del BIOS (PB0-3 → DB4-7, PB4 RS, PB5 RW, PB6 E); '8bit' = README della
  scheda LCD_KEYb (PB dati, RS/RW/E su PA5/PA6/PA7, ipotesi Ben Eater). La parte tastiera della scheda non e' emulata.
- Bus: con schede sovrapposte risponde la prima nell'ordine del rack (`BO6502_BOARD_ORDER`); il rack segnala il conflitto.
- Big LCD: la RAM del T6963 e' casuale all'accensione (`Board.powerOn()`), come sul display reale.
- RAM all'accensione: **azzerata di default** (come `minivic.js`), opzione "casuale" nel pannello Rack.
  Motivo (2026-10-23): alcuni giochi leggono variabili prima di inizializzarle, perche' abilitano l'INT del VDP
  quando il flag F e' gia' alto (il BIOS non legge mai lo stato) e l'NMI parte subito:
  `centipede.asm` (RESET scrive R1=$E6 prima che TITLE azzeri `QGO` $79 -> coda casuale, schermo nero),
  `the_warriors.asm` (`SAT_BUFFER` $0260 copiato dall'NMI prima di essere scritto), `asteroids.asm` (`WAVE` $91).
  Da segnalare/correggere nei giochi: inizializzare le variabili dell'NMI (o leggere VREG) prima di abilitare l'INT.

## BIOS miniVIC (sorgente: `G:\Il mio Drive\Progetti\6205\001 - MSBASIC\023 - ...\msbasic\`)
- Vettori: RESET `$E000` (menu), NMI `$A785` → `PHA PHX PHY / JSR $0FD0 / LDA $B001 / PLY PLX PLA / RTI`,
  IRQ `$A9A3` → `JSR $0FA0` (trampolini in RAM forniti dal programma).
- Menu: 1 WozMon (`$FE00`), 2 MS BASIC (`$8000`), 3 programmi da SD, 4 informazioni.
- `CHRIN`: ACIA, poi buffer tastiera `$0400` (puntatori `$0306/$0307`, flag `$0308`); la tastiera è letta
  in **polling** del flag CA1 (`IFR $D18D` bit 1) — nessun IRQ abilitato. `CHROUT` scrive su VDP (modo Text 40x24) e ACIA.
- SD: `$DD81/$DD83` cablati nel BIOS. Con il BO6502 (SD a `$D1B0`) il menu SD funziona solo con una ROM
  compilata per quell'indirizzo, oppure spostando la scheda SD a `$DD80` nel rack.
- Formato SD (make_sd.py): programma N a `(N-1)*$8000`, dati a `+$1000`; pagina directory P nel primo settore
  del blocco P: `"BOGS"`, versione 3, n. programmi, flag RUN, parametri (load, len, entry) a `+16+i*8`, nomi a `+96+i*32`.
- Il caricamento da SD è lento come sul vero hardware (~6 s per 23 KB): è SPI bit-bang.

## Terminale seriale
- Impaginazione di default **'crt'**: riproduce `print_crt_ch` del BIOS (crt_text_drv.s), cosi' la seriale mostra la
  stessa pagina del VDU: 40x24, LF = a capo, CR ignorato, a capo automatico a 40 colonne, dopo la riga 24 si riparte
  dalla riga 0 con lo schermo pulito, ESC (+ sequenza ANSI) = pulisci e torna in alto.
- 'ansi' = terminale VT100 80x24 con scorrimento (come un PC collegato alla DB9).
- `tests/serial.test.ts` confronta CRT e seriale ogni 5 frame (tollera un carattere in transito: CHROUT scrive prima sul VDP).

## Temporizzazione
- Frame NTSC: 262 righe, 59,92 Hz; cicli per riga = clock / (59,922743 × 262) (≈ 63,7 a 1 MHz).
- Alla fine di ogni riga il VDP disegna la riga; alla fine della 191 alza F (e INT se abilitato).
- Le schede con `tick()` (VIA, tastiera) avanzano dopo ogni istruzione; l'audio si sincronizza al ciclo
  corrente prima di ogni accesso alla scheda audio e a fine frame.
- Nel browser il ritmo lo dà la coda audio (~70 ms); senza audio l'orologio del browser.

## Interfaccia
- Barra: scelta macchina (BO6502 / miniVIC), POWER, RESET, Pausa, velocità, "Tasti → Tastiera/Joystick", mute, schermo intero.
- Tastiera PS/2 virtuale (layout US come la tabella del BIOS; Shift/Ctrl/Alt agganciati con il mouse) e due
  joystick SMS cliccabili (croce trascinabile anche in diagonale, multi-touch). Si illuminano anche con tastiera fisica e gamepad.
- Tasti fisici in modo joystick: P1 frecce + Z/Spazio (1) + X (2); P2 WASD + F (1) + G (2). Gamepad API: primi due pad.
- Pannelli: Giochi, Media (ROM, programma .bin, dump WozMon, SD .img, creazione SD), Rack, Audio (VU L/R,
  registri e note dei due AY, mute per canale), Seriale (impaginazione 'crt' o 'ansi'), Debug (CPU, disassemblato, passo/frame,
  breakpoint, memoria CPU/VRAM, VDP, VIA).

## Da fare (prossimi passi)
- Schede mancanti: tastiera della scheda LCD legacy, Monitor (Arduino Mega sniffer).
- T6963: modo attributi testo, screen peek/copy, font 6x8 (FS = 1); HD44780: tempi di busy reali, CGROM giapponese A00.
- Verificare sugli schemi: lettura dei registri AY, decodifica della scheda audio BO6502 (il README del modulo
  indica A0 = BC1, A1 = BDIR, A2 = 0 sinistro, diversa dal miniVIC), linea IRQ di ACIA/VIA.
- Salvataggio/ripristino dello stato, scrittura SD persistente, timing VRAM del TMS (accessi troppo ravvicinati).

## Regole
- Prima di cambiare CPU, VDP o AY esegui `npm test` e guarda gli screenshot in `tests/out/`.
- Un comportamento hardware non documentato va chiesto all'utente, non inventato: segnalo in "Da fare".
- Commit e push solo quando l'utente lo chiede.
