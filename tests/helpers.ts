// Shared test helpers: frame PNGs, screen text, keys
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Machine } from '../src/core/Machine';
import { TMS_PALETTE, SCREEN_W, SCREEN_H } from '../src/devices/TMS9918A';
import { KeyboardBoard } from '../src/boards/Boards';

export const OUT = join(process.cwd(), 'tests', 'out');

export function savePng(m: Machine, name: string): string {
  const vdp = m.vdu!.vdp;
  return writePng(name, SCREEN_W, SCREEN_H, (x, y) => TMS_PALETTE[vdp.frame[y * SCREEN_W + x]]);
}

/** generic PNG: pixel(x, y) -> [r, g, b] */
export function writePng(name: string, w: number, h: number, pixel: (x: number, y: number) => readonly number[]): string {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name + '.png');
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
  return file;
}

/** name table text in Text mode (40x24) */
export function screenText(m: Machine): string {
  const vdp = m.vdu!.vdp;
  const nt = (vdp.reg[2] & 0x0F) << 10;
  const lines: string[] = [];
  for (let r = 0; r < 24; r++) {
    let s = '';
    for (let c = 0; c < 40; c++) {
      const ch = vdp.vram[nt + r * 40 + c];
      s += ch >= 0x20 && ch < 0x7F ? String.fromCharCode(ch) : '.';
    }
    lines.push(s.trimEnd());
  }
  return lines.join('\n');
}

export function runFrames(m: Machine, n: number): void {
  for (let i = 0; i < n; i++) m.runFrame();
}

/** presses and releases a PS/2 key */
export function tap(m: Machine, code: string, frames = 4): void {
  const kb = m.board<KeyboardBoard>('keyboard')!.keyboard;
  kb.keyDown(code);
  runFrames(m, frames);
  kb.keyUp(code);
  runFrames(m, frames);
}

export function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
