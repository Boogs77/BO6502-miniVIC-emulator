// Immagine SD per il menu "SD PROGRAMS" del BIOS - stesso formato di make_sd.py
//
//   programma N (1..255) -> blocco da 32KB all'offset (N-1) * $8000, dati a blocco + $1000
//   directory a pagine (v3): la pagina P sta nel primo settore del blocco P
//     +0..3 "BOGS"  +4 versione 3  +5 programmi della pagina (1..9)
//     +6..14 flag (bit0 = esegui dopo il caricamento)  +15 totale programmi
//     +16 + i*8  load (lo,hi), lunghezza (lo,hi), entry (lo,hi), 0, 0
//     +96 + i*32 nome (ASCII, max 31 caratteri + $00)

export interface SdProgram {
  name: string;
  data: Uint8Array;
  load: number;
  entry: number;
  /** esegui subito dopo il caricamento */
  run: boolean;
}

const BLOCK = 0x8000;
const RESERVED = 0x1000;
const PAYLOAD = BLOCK - RESERVED;
const SECTOR = 512;
const PER_PAGE = 9;
const MIN_LOAD = 0x0F00;
const RAM_END = 0x8000;

/** controlla un programma; ritorna un messaggio d'errore o null */
export function checkProgram(p: SdProgram): string | null {
  if (!p.data.length) return 'file vuoto';
  if (p.data.length > PAYLOAD) return `troppo grande (${p.data.length} byte, max ${PAYLOAD})`;
  if (p.load < MIN_LOAD) return `caricamento sotto $${MIN_LOAD.toString(16).toUpperCase()}`;
  if (p.load + p.data.length > RAM_END) return 'supera la fine della RAM ($7FFF)';
  if (p.entry < p.load || p.entry >= p.load + p.data.length) return 'entry fuori dal programma';
  return null;
}

/** entry di default come make_sd.py: $1000 se cade nell'immagine, altrimenti l'indirizzo di caricamento */
export function defaultEntry(load: number, length: number): number {
  return load <= 0x1000 && 0x1000 < load + length ? 0x1000 : load;
}

export function buildSdImage(programs: SdProgram[]): Uint8Array {
  if (programs.length < 1 || programs.length > 255) throw new Error('servono da 1 a 255 programmi');
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

/** legge la directory di un'immagine (per mostrarne il contenuto) */
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
    if (d[4] === 2) break; // la v2 ha una sola pagina
  }
  return out;
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0) & 0x7F);
}

function hex4(v: number): string {
  return v.toString(16).toUpperCase().padStart(4, '0');
}
