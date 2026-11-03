// SaveArea - the save area of the SD card (game records and saved games), kept apart from the image
//
// On the real card the area starts at 16 MB (sector 32768, byte $01000000), right after the end of
// sd_full.img, so writing an SD image never erases it. It holds 256 zones of 16 sectors (2 MB):
// zone z = sectors 32768 + z*16 ... +15, one zone per game or application (fixed numbers).
// Here the sectors live in a sparse map, outside the SD image: they survive a new SD image (the
// emulator keeps them in the browser, see app/saveStore.ts) and can be exported/imported as JSON.
// A sector never written reads as zeros, like an erased area of a fresh card.
// Sector format (MVSV records, zones, game numbers): SD_SALVATAGGI.md of the miniVIC projects.

export const SAVE_FIRST = 32768;       // first sector of the area (16 MB)
export const SAVE_SECTORS = 4096;      // 256 zones x 16 sectors
export const SAVE_ZONE = 16;           // sectors per zone
const BLOCK = 512;

/** one records table read from a sector (row: score digits, initials, extra byte) */
export interface SaveRecords {
  zone: number;
  game: string;
  counter: number;
  rows: Array<{ score: string; name: string; extra: number }>;
}

export class SaveArea {
  /** written sectors (absolute sector number -> 512 bytes) */
  readonly sectors = new Map<number, Uint8Array>();
  /** called after a write, with the absolute sector number */
  onWrite: (sector: number) => void = () => {};

  /** true if the sector belongs to the area */
  static contains(sector: number): boolean {
    return sector >= SAVE_FIRST && sector < SAVE_FIRST + SAVE_SECTORS;
  }

  read(sector: number): Uint8Array {
    return this.sectors.get(sector) ?? new Uint8Array(BLOCK);
  }

  write(sector: number, data: ArrayLike<number>): void {
    const s = Uint8Array.from(data).subarray(0, BLOCK);
    if (s.every(b => b === 0)) this.sectors.delete(sector);   // zeros = erased: nothing to keep
    else this.sectors.set(sector, s);
    this.onWrite(sector);
  }

  clear(): void {
    const all = [...this.sectors.keys()];
    this.sectors.clear();
    for (const s of all) this.onWrite(s);
  }

  /** records tables found in the area (sectors 0 and 1 of each zone, the valid copy with the higher counter) */
  records(): SaveRecords[] {
    const out: SaveRecords[] = [];
    for (let z = 0; z < SAVE_SECTORS / SAVE_ZONE; z++) {
      const base = SAVE_FIRST + z * SAVE_ZONE;
      const copies = [0, 1].map(i => this.sectors.get(base + i)).filter((s): s is Uint8Array => !!s)
        .map(s => parseRecords(s, z)).filter((r): r is SaveRecords => !!r);
      if (copies.length) out.push(copies.reduce((a, b) => (b.counter > a.counter ? b : a)));
    }
    return out;
  }

  /** JSON export: the written sectors in base64, plus the records in readable form (ignored on import) */
  toJSON(): object {
    const sectors: Record<string, string> = {};
    for (const [n, d] of [...this.sectors].sort((a, b) => a[0] - b[0])) sectors[n] = toBase64(d);
    return { format: 'minivic-saves', version: 1, first: SAVE_FIRST, sectors, records: this.records() };
  }

  /** replaces the area with an export; returns the number of sectors read */
  fromJSON(json: unknown): number {
    const j = json as { format?: string; sectors?: Record<string, string> };
    if (!j || j.format !== 'minivic-saves' || typeof j.sectors !== 'object') throw new Error('not a miniVIC saves file');
    const next = new Map<number, Uint8Array>();
    for (const [k, v] of Object.entries(j.sectors!)) {
      const n = Number(k), d = fromBase64(v);
      if (!SaveArea.contains(n) || d.length !== BLOCK) throw new Error(`bad sector ${k}`);
      next.set(n, d);
    }
    this.clear();
    for (const [n, d] of next) this.write(n, d);
    return next.size;
  }
}

/** a records sector: "MVSV", version 1, zone, type 1, tables, rows, row size 8, counter, name, rows, 16-bit sum */
function parseRecords(s: Uint8Array, zone: number): SaveRecords | null {
  if (String.fromCharCode(...s.subarray(0, 4)) !== 'MVSV' || s[4] !== 1 || s[5] !== zone || s[6] !== 1) return null;
  let sum = 0;
  for (let i = 0; i < 510; i++) sum = (sum + s[i]) & 0xFFFF;
  if (sum !== (s[510] | (s[511] << 8))) return null;
  const tables = s[7], perTable = s[8], size = s[9];
  if (size !== 8 || 32 + tables * perTable * size > 510) return null;
  const rows = [];
  for (let i = 0; i < tables * perTable; i++) {
    const r = s.subarray(32 + i * 8, 40 + i * 8);
    const score = [3, 2, 1, 0].map(k => r[k].toString(16).padStart(2, '0')).join('').replace(/^0+(?=\d)/, '');
    rows.push({ score, name: String.fromCharCode(...r.subarray(4, 7)), extra: r[7] });
  }
  return { zone, game: String.fromCharCode(...s.subarray(16, 32)).trim(), counter: s[10] | (s[11] << 8), rows };
}

function toBase64(d: Uint8Array): string {
  let s = '';
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(t: string): Uint8Array {
  return Uint8Array.from(atob(t), c => c.charCodeAt(0));
}
