// Schede di uscita del BO6502 collegate a una W65C22: Big LCD, LCD legacy 16x2 e LED test

import { BaseBoard } from './Boards';
import { VIA6522 } from '../devices/VIA6522';
import { T6963 } from '../devices/T6963';
import { HD44780 } from '../devices/HD44780';

// ---------------------------------------------------------------- BIG LCD T6963
// PB = bus dati; PA0 /RD, PA1 /WR, PA2 /CE, PA3 C/D, PA4 /HALT, PA5 /RST
// (BIGLCD-65c22_test, BIGLCD_HELLOWORLD.ASM)
const LCD_RD = 0x01, LCD_WR = 0x02, LCD_CE = 0x04, LCD_CD = 0x08, LCD_RST = 0x20;

export class BigLcdBoard extends BaseBoard {
  readonly type = 'biglcd';
  readonly label = 'Big LCD T6963 160x128';
  readonly size = 0x10;
  readonly via = new VIA6522();
  readonly lcd = new T6963();
  private ctrl = 0xFF;

  constructor(base = 0xD190) {
    super(base, 'irq');
    this.via.onIrq = on => this.interrupt(on);
    this.via.onPortAChange = v => this.control(v);
  }

  private control(v: number): void {
    const prev = this.ctrl;
    this.ctrl = v;
    if (!(v & LCD_RST)) { this.lcd.reset(); return; }
    const ce = !(v & LCD_CE);
    // scrittura sul fronte di salita di /WR
    if (ce && !(prev & LCD_WR) && (v & LCD_WR)) {
      const data = this.via.portB();
      if (v & LCD_CD) this.lcd.writeCommand(data);
      else this.lcd.writeData(data);
    }
    // lettura: il controller pilota il bus mentre /RD e /CE sono bassi
    if (ce && !(v & LCD_RD)) {
      // il dato si prende una volta sola, sul fronte di discesa di /RD (in auto read avanza il puntatore)
      if ((prev & LCD_RD) || (prev & LCD_CE)) {
        this.via.inputB = v & LCD_CD ? this.lcd.status : this.lcd.readData();
      }
    } else {
      this.via.inputB = 0xFF;
    }
  }

  /** all'accensione la RAM del display contiene dati casuali (si vedono finche' non si pulisce) */
  powerOn(): void {
    const r = this.lcd.ram;
    for (let i = 0; i < r.length; i++) r[i] = (Math.random() * 256) | 0;
  }

  reset(): void { this.via.reset(); this.lcd.reset(); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); }
}

// ---------------------------------------------------------------- LCD legacy HD44780
/**
 * Cablaggio dell'LCD sulla VIA:
 *  '4bit': PB0-PB3 = DB4-DB7, PB4 RS, PB5 RW, PB6 E (lcd.s del BIOS)
 *  '8bit': PB0-PB7 = DB0-DB7, PA5 RS, PA6 RW, PA7 E (README della scheda LCD_KEYb)
 */
export type LcdWiring = '4bit' | '8bit';

export class LcdBoard extends BaseBoard {
  readonly type = 'lcd';
  readonly label = 'LCD HD44780 16x2';
  readonly size = 0x1000;           // decodifica parziale: tutta la pagina $Dxxx
  readonly via = new VIA6522();
  readonly lcd = new HD44780();
  wiring: LcdWiring;

  constructor(base = 0xD000, wiring: LcdWiring = '4bit') {
    super(base, 'irq');
    this.wiring = wiring;
    this.via.onIrq = on => this.interrupt(on);
    this.via.onPortBChange = () => this.update();
    this.via.onPortAChange = () => this.update();
  }

  private update(): void {
    const pb = this.via.portB();
    let out: number;
    if (this.wiring === '4bit') {
      out = this.lcd.pins(pb & 0x10, pb & 0x20, pb & 0x40, (pb & 0x0F) << 4);
      // il display guida DB4-DB7 = PB0-PB3
      this.via.inputB = out < 0 ? 0xFF : (0xF0 | (out >> 4));
    } else {
      const pa = this.via.portA();
      out = this.lcd.pins(pa & 0x20, pa & 0x40, pa & 0x80, pb);
      this.via.inputB = out < 0 ? 0xFF : out;
    }
  }

  reset(): void { this.via.reset(); this.lcd.reset(); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); }
}

// ---------------------------------------------------------------- LED test
/** 16 LED: PA0-PA7 primo banco, PB0-PB7 secondo banco; acceso = uscita a 1 */
export class LedBoard extends BaseBoard {
  readonly type = 'leds';
  readonly label = 'LED test 16x';
  readonly size = 0x1000;           // decodifica parziale: tutta la pagina $Dxxx
  readonly via = new VIA6522();

  constructor(base = 0xD000) {
    super(base, 'irq');
    this.via.onIrq = on => this.interrupt(on);
  }

  /** LED accesi: bit 0-7 porta A, bit 8-15 porta B */
  get leds(): number {
    const v = this.via;
    return (v.ora & v.ddra) | ((v.orb & v.ddrb) << 8);
  }

  reset(): void { this.via.reset(); }
  read(o: number): number { return this.via.read(o); }
  write(o: number, v: number): void { this.via.write(o, v); }
  peek(o: number): number { return this.via.peek(o); }
  tick(n: number): void { this.via.tick(n); }
}
