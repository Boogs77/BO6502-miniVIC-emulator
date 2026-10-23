; leds.asm - test della scheda LED (esempio del README): VIA a $D000, porte in uscita
 .org $1000
  LDA #$FF
  STA $D002             ; DDRB in uscita
  STA $D003             ; DDRA in uscita
  LDA #$A5
  STA $D001             ; PA = 10100101
  LDA #$3C
  STA $D000             ; PB = 00111100
LOOP:
  JMP LOOP
