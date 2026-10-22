// Test dei chip: TMS9918A (porte, sprite, collisioni) e AY-3-8910 (tono, inviluppo)
import { TMS9918A } from '../src/devices/TMS9918A';
import { AY38910, AY_LEVELS } from '../src/devices/AY38910';
import { assert } from './helpers';

function vdpWriteReg(v: TMS9918A, r: number, val: number) { v.writeControl(val); v.writeControl(0x80 | r); }
function vdpSetWrite(v: TMS9918A, a: number) { v.writeControl(a & 0xFF); v.writeControl(0x40 | (a >> 8)); }
function vdpSetRead(v: TMS9918A, a: number) { v.writeControl(a & 0xFF); v.writeControl(a >> 8); }

function testVdpPorts(): void {
  const v = new TMS9918A();
  vdpSetWrite(v, 0x1234);
  v.writeData(0xAA); v.writeData(0xBB);
  vdpSetRead(v, 0x1234);                    // read-ahead: il primo dato e' gia' nel buffer
  assert(v.readData() === 0xAA && v.readData() === 0xBB, 'read-ahead della VRAM');
  vdpWriteReg(v, 7, 0xF4);
  assert(v.reg[7] === 0xF4, 'scrittura registro');
}

function testSprites(): void {
  const v = new TMS9918A();
  // Graphics I, display on, sprite 8x8; SAT a $1B00, pattern sprite a $3800
  vdpWriteReg(v, 1, 0x40); vdpWriteReg(v, 5, 0x36); vdpWriteReg(v, 6, 0x07);
  for (let i = 0; i < 8; i++) v.vram[0x3800 + i] = 0xFF;  // pattern 0 pieno
  // 5 sprite sulla stessa riga (Y=49 -> righe 50..57), il quinto e' il numero 4
  for (let s = 0; s < 5; s++) v.vram.set([49, s * 20, 0, 15], 0x1B00 + s * 4);
  v.vram[0x1B00 + 20] = 0xD0;
  for (let y = 0; y < 262; y++) v.endOfLine(y);
  const st = v.readStatus();
  assert(st & 0x80, 'flag F di vblank');
  assert(st & 0x40, 'flag 5S');
  assert((st & 0x1F) === 4, `numero del quinto sprite: ${st & 0x1F}`);
  assert(!(st & 0x20), 'nessuna collisione (sprite separati)');
  assert((v.readStatus() & 0xE0) === 0, 'la lettura azzera F, 5S e C');

  // due sprite sovrapposti -> collisione, anche se uno ha colore 0 (trasparente)
  v.vram.set([99, 100, 0, 0], 0x1B00);
  v.vram.set([99, 104, 0, 8], 0x1B04);
  v.vram[0x1B08] = 0xD0;
  for (let y = 0; y < 262; y++) v.endOfLine(y);
  assert(v.readStatus() & 0x20, 'collisione tra sprite');
}

function testVdpInterrupt(): void {
  const v = new TMS9918A();
  let int = false;
  v.onInterrupt = on => { int = on; };
  vdpWriteReg(v, 1, 0x60);                  // display on + IE
  for (let y = 0; y < 192; y++) v.endOfLine(y);
  assert(int, 'INT attivo dopo la riga 191');
  v.readStatus();
  assert(!int, 'INT si spegne leggendo lo stato');
}

/** frequenza di un canale contando i fronti di salita dell'uscita */
function measure(ay: AY38910, ch: number, ticks: number, clock: number): number {
  let edges = 0, last = 0;
  for (let i = 0; i < ticks; i++) {
    ay.tick();
    const on = ay.out[ch] > 0 ? 1 : 0;
    if (on && !last) edges++;
    last = on;
  }
  return edges / (ticks * 8 / clock);
}

function testAyTone(): void {
  const ay = new AY38910();
  ay.reset();
  // La4 = 440 Hz a 1 MHz: TP = 1e6 / (16 * 440) = 142
  ay.writeReg(0, 142); ay.writeReg(1, 0);
  ay.writeReg(7, 0b111110);                 // solo tono A
  ay.writeReg(8, 15);
  const f = measure(ay, 0, 125000, 1_000_000);
  assert(Math.abs(f - 1_000_000 / (16 * 142)) < 2, `frequenza tono: ${f}`);
  assert(ay.out[0] === 0 || ay.out[0] === AY_LEVELS[15], 'livello massimo');
}

function testAyEnvelope(): void {
  const ay = new AY38910();
  ay.reset();
  ay.writeReg(7, 0b111111);                 // tutto spento: uscita = volume (DC)
  ay.writeReg(8, 0x10);                     // canale A da inviluppo
  ay.writeReg(11, 1); ay.writeReg(12, 0);   // periodo minimo: un passo ogni 2 tick
  ay.writeReg(13, 0x00);                    // \___ : scende e resta a 0
  const seen: number[] = [];
  for (let i = 0; i < 40; i++) { ay.tick(); seen.push(ay.out[0]); }
  assert(seen[0] > seen[20] && seen[39] === 0, 'forma 0: discesa e poi zero');
  ay.writeReg(13, 0x0D);                    // /‾‾‾ : sale e resta al massimo
  for (let i = 0; i < 40; i++) ay.tick();
  assert(ay.out[0] === AY_LEVELS[15], 'forma 13: resta al massimo');
  ay.writeReg(13, 0x0E);                    // /\/\ : triangolo continuo
  const tri: number[] = [];
  for (let i = 0; i < 128; i++) { ay.tick(); tri.push(ay.out[0]); }
  assert(tri.includes(0) && tri.includes(AY_LEVELS[15]), 'forma 14: triangolo');
}

export default async function () {
  testVdpPorts();
  testSprites();
  testVdpInterrupt();
  testAyTone();
  testAyEnvelope();
}
