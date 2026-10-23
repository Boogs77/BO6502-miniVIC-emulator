; lcd16.asm - legacy LCD board test (4-bit HD44780, BIOS lcd.s routines)
; VIA at $D000: PB0-3 = DB4-7, PB4 RS, PB5 RW, PB6 E. Writes two lines, reads the busy flag.
PORTB = $D000
DDRB  = $D002
E     = %01000000
RW    = %00100000
RS    = %00010000

 .org $1000
START:
  LDA #$FF
  STA DDRB
  LDA #%00000010        ; 4 bit (with the interface still in 8-bit mode)
  STA PORTB
  ORA #E
  STA PORTB
  AND #%00001111
  STA PORTB
  LDA #%00101000        ; 4 bit, 2 lines, 5x8
  JSR LCD_INSTR
  LDA #%00001110        ; display on, cursor on
  JSR LCD_INSTR
  LDA #%00000110        ; increment, no shift
  JSR LCD_INSTR
  LDA #%00000001        ; clear
  JSR LCD_INSTR
  LDX #0
.l1:
  LDA MSG1,X
  BEQ .r2
  JSR LCD_CHAR
  INX
  BNE .l1
.r2:
  LDA #$C0              ; DDRAM $40: second line
  JSR LCD_INSTR
  LDX #0
.l2:
  LDA MSG2,X
  BEQ .done
  JSR LCD_CHAR
  INX
  BNE .l2
.done:
  JMP .done

LCD_WAIT:
  PHA
  LDA #%11110000        ; data as input
  STA DDRB
.busy:
  LDA #RW
  STA PORTB
  LDA #(RW | E)
  STA PORTB
  LDA PORTB             ; high nibble with the busy flag
  PHA
  LDA #RW
  STA PORTB
  LDA #(RW | E)
  STA PORTB
  LDA PORTB             ; low nibble
  PLA
  AND #%00001000
  BNE .busy
  LDA #RW
  STA PORTB
  LDA #$FF
  STA DDRB
  PLA
  RTS

LCD_INSTR:
  JSR LCD_WAIT
  PHA
  LSR
  LSR
  LSR
  LSR
  STA PORTB
  ORA #E
  STA PORTB
  EOR #E
  STA PORTB
  PLA
  AND #%00001111
  STA PORTB
  ORA #E
  STA PORTB
  EOR #E
  STA PORTB
  RTS

LCD_CHAR:
  JSR LCD_WAIT
  PHA
  LSR
  LSR
  LSR
  LSR
  ORA #RS
  STA PORTB
  ORA #E
  STA PORTB
  EOR #E
  STA PORTB
  PLA
  AND #%00001111
  ORA #RS
  STA PORTB
  ORA #E
  STA PORTB
  EOR #E
  STA PORTB
  RTS

MSG1: .byte "BO6502 LCD 16x2", 0
MSG2: .byte "HD44780 4 BIT!", 0
