// Chip tests: TMS9918A (ports, sprites, collisions) and AY-3-8910 (tone, envelope)
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
  vdpSetRead(v, 0x1234);                    // read-ahead: the first byte is already in the buffer
  assert(v.readData() === 0xAA && v.readData() === 0xBB, 'VRAM read-ahead');
  vdpWriteReg(v, 7, 0xF4);
  assert(v.reg[7] === 0xF4, 'register write');
}

function testSprites(): void {
  const v = new TMS9918A();
  // Graphics I, display on, 8x8 sprites; SAT at $1B00, sprite patterns at $3800
  vdpWriteReg(v, 1, 0x40); vdpWriteReg(v, 5, 0x36); vdpWriteReg(v, 6, 0x07);
  for (let i = 0; i < 8; i++) v.vram[0x3800 + i] = 0xFF;  // pattern 0 solid
  // 5 sprites on the same line (Y=49 -> lines 50..57), the fifth is number 4
  for (let s = 0; s < 5; s++) v.vram.set([49, s * 20, 0, 15], 0x1B00 + s * 4);
  v.vram[0x1B00 + 20] = 0xD0;
  for (let y = 0; y < 262; y++) v.endOfLine(y);
  const st = v.readStatus();
  assert(st & 0x80, 'vblank F flag');
  assert(st & 0x40, 'flag 5S');
  assert((st & 0x1F) === 4, `fifth sprite number: ${st & 0x1F}`);
  assert(!(st & 0x20), 'no collision (separate sprites)');
  assert((v.readStatus() & 0xE0) === 0, 'reading clears F, 5S and C');

  // two overlapping sprites -> collision, even if one has colour 0 (transparent)
  v.vram.set([99, 100, 0, 0], 0x1B00);
  v.vram.set([99, 104, 0, 8], 0x1B04);
  v.vram[0x1B08] = 0xD0;
  for (let y = 0; y < 262; y++) v.endOfLine(y);
  assert(v.readStatus() & 0x20, 'sprite collision');
}

function testVdpInterrupt(): void {
  const v = new TMS9918A();
  let int = false;
  v.onInterrupt = on => { int = on; };
  vdpWriteReg(v, 1, 0x60);                  // display on + IE
  for (let y = 0; y < 192; y++) v.endOfLine(y);
  assert(int, 'INT active after line 191');
  v.readStatus();
  assert(!int, 'INT goes off when the status is read');
}

/** frequency of a channel, counting the rising edges of its output */
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
  // A4 = 440 Hz at 1 MHz: TP = 1e6 / (16 * 440) = 142
  ay.writeReg(0, 142); ay.writeReg(1, 0);
  ay.writeReg(7, 0b111110);                 // tone A only
  ay.writeReg(8, 15);
  const f = measure(ay, 0, 125000, 1_000_000);
  assert(Math.abs(f - 1_000_000 / (16 * 142)) < 2, `tone frequency: ${f}`);
  assert(ay.out[0] === 0 || ay.out[0] === AY_LEVELS[15], 'maximum level');
}

function testAyEnvelope(): void {
  const ay = new AY38910();
  ay.reset();
  ay.writeReg(7, 0b111111);                 // everything off: output = volume (DC)
  ay.writeReg(8, 0x10);                     // channel A from the envelope
  ay.writeReg(11, 1); ay.writeReg(12, 0);   // minimum period: one step every 2 ticks
  ay.writeReg(13, 0x00);                    // \___ : falls and stays at 0
  const seen: number[] = [];
  for (let i = 0; i < 40; i++) { ay.tick(); seen.push(ay.out[0]); }
  assert(seen[0] > seen[20] && seen[39] === 0, 'shape 0: decay then zero');
  ay.writeReg(13, 0x0D);                    // /‾‾‾ : rises and stays at maximum
  for (let i = 0; i < 40; i++) ay.tick();
  assert(ay.out[0] === AY_LEVELS[15], 'shape 13: stays at maximum');
  ay.writeReg(13, 0x0E);                    // /\/\ : continuous triangle
  const tri: number[] = [];
  for (let i = 0; i < 128; i++) { ay.tick(); tri.push(ay.out[0]); }
  assert(tri.includes(0) && tri.includes(AY_LEVELS[15]), 'shape 14: triangle');
}

export default async function () {
  testVdpPorts();
  testSprites();
  testVdpInterrupt();
  testAyTone();
  testAyEnvelope();
}
