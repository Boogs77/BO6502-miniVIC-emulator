; leds.asm - LED board test (README example): VIA at $D000, ports as outputs
 .org $1000
  LDA #$FF
  STA $D002             ; DDRB as output
  STA $D003             ; DDRA as output
  LDA #$A5
  STA $D001             ; PA = 10100101
  LDA #$3C
  STA $D000             ; PB = 00111100
LOOP:
  JMP LOOP
