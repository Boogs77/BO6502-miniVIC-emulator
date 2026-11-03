# Serial terminal (src/ui/Terminal.ts, TerminalModel.ts)
- Default **'crt'** layout: reproduces the BIOS `print_crt_ch` (crt_text_drv.s), so the serial port shows the same
  page as the VDU: 40x24, LF = new line, CR ignored, automatic wrap at 40 columns, after row 24 it restarts from
  row 0 with a cleared screen, ESC (+ ANSI sequence) = clear and go home.
- 'ansi' = VT100 80x24 terminal with scrolling (like a PC connected to the DB9).
- `tests/serial.test.ts` compares CRT and serial every 5 frames (tolerates one character in flight: CHROUT writes to the VDP first).
