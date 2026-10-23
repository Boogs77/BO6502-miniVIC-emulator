// SD image for the BIOS "SD PROGRAMS" menu - same format as make_sd.py
//
//   program N (1..255) -> 32KB block at offset (N-1) * $8000, data at block + $1000
//   paged directory (v3): page P is in the first sector of block P
//     +0..3 "BOGS"  +4 version 3  +5 programs in the page (1..9)
//     +6..14 flags (bit0 = run after loading)  +15 total programs
//     +16 + i*8  load (lo,hi), length (lo,hi), entry (lo,hi), 0, 0
//     +96 + i*32 name (ASCII, max 31 characters + $00)

export interface SdProgram {
  name: string;
  data: Uint8Array;
  load: number;
  entry: number;
  /** run right after loading */
  run: boolean;
}

const BLOCK = 0x8000;
const RESERVED = 0x1000;
const PAYLOAD = BLOCK - RESERVED;
const SECTOR = 512;
const PER_PAGE = 9;
const MIN_LOAD = 0x0F00;
const RAM_END = 0x8000;

/** checks a program; returns an error message or null */
export function checkProgram(p: SdProgram): string | null {
  if (!p.data.length) return 'empty file';
  if (p.data.length > PAYLOAD) return `too big (${p.data.length} bytes, max ${PAYLOAD})`;
  if (p.load < MIN_LOAD) return `loads below $${MIN_LOAD.toString(16).toUpperCase()}`;
  if (p.load + p.data.length > RAM_END) return 'goes past the end of RAM ($7FFF)';
  if (p.entry < p.load || p.entry >= p.load + p.data.length) return 'entry outside the program';
  return null;
}

/** default entry like make_sd.py: $1000 if it falls inside the image, otherwise the load address */
export function defaultEntry(load: number, length: number): number {
  return load <= 0x1000 && 0x1000 < load + length ? 0x1000 : load;
}

export function buildSdImage(programs: SdProgram[]): Uint8Array {
  if (programs.length < 1 || programs.length > 255) throw new Error('1 to 255 programs are required');
  const image = new Uint8Array(programs.length * BLOCK);
  programs.forEach((p, n) => {
    const err = checkProgram(p);
    if (err) throw new Error(`${p.name}: ${err}`);
    const info = `BO6502 SD PROGRAM ${n + 1} slot=${n} load=${hex4(p.load)} len=${p.data.length} entry=${hex4(p.entry)}\n`;
    image.set(ascii(info), n * BLOCK + SECTOR);
    image.set(p.data, n * BLOCK + RESERVED);
  });
  const pages = Math.ceil(programs.length / PER_PAGE);
  for (let pg = 0; pg < pages; pg++) {
    const d = new Uint8Array(SECTOR);
    d.set(ascii('BOGS'), 0);
    d[4] = 3;
    const chunk = programs.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
    d[5] = chunk.length;
    d[15] = programs.length;
    chunk.forEach((p, i) => {
      d[6 + i] = p.run ? 1 : 0;
      const o = 16 + i * 8;
      d[o] = p.load & 0xFF; d[o + 1] = p.load >> 8;
      d[o + 2] = p.data.length & 0xFF; d[o + 3] = p.data.length >> 8;
      d[o + 4] = p.entry & 0xFF; d[o + 5] = p.entry >> 8;
      const name = p.name.toUpperCase().replace(/[^\x20-\x7E]/g, '?').slice(0, 31);
      d.set(ascii(name), 96 + i * 32);
    });
    image.set(d, pg * BLOCK);
  }
  return image;
}

/** reads the directory of an image (to show its content) */
export function readSdDirectory(image: Uint8Array): Array<{ name: string; load: number; length: number; entry: number; run: boolean }> {
  const out = [];
  for (let pg = 0; pg * BLOCK + SECTOR <= image.length; pg++) {
    const d = image.subarray(pg * BLOCK, pg * BLOCK + SECTOR);
    if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'BOGS' || d[4] < 2 || d[4] > 3) break;
    for (let i = 0; i < d[5] && i < PER_PAGE; i++) {
      const o = 16 + i * 8;
      let name = '';
      for (let k = 96 + i * 32; k < 96 + i * 32 + 32 && d[k]; k++) name += String.fromCharCode(d[k]);
      out.push({
        name,
        load: d[o] | (d[o + 1] << 8),
        length: d[o + 2] | (d[o + 3] << 8),
        entry: d[o + 4] | (d[o + 5] << 8),
        run: (d[6 + i] & 1) !== 0,
      });
    }
    if (d[4] === 2) break; // v2 has a single page
  }
  return out;
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0) & 0x7F);
}

function hex4(v: number): string {
  return v.toString(16).toUpperCase().padStart(4, '0');
}
