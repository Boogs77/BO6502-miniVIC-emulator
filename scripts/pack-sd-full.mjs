#!/usr/bin/env node
// pack-sd-full.mjs - brings the full SD of bo6502-SDbuilder (games, MiniVIC Apps, songs, documents) into the emulator
//
//   node scripts/pack-sd-full.mjs            gzips ../bo6502-SDbuilder/sd_full.img into public/sd_full.img.gz
//   node scripts/pack-sd-full.mjs --check    check only: exit 0 = in sync, 2 = there are differences
//   --source <file>                          image to pack (default: MINIVIC_SD_FULL, then ../bo6502-SDbuilder/sd_full.img)
//
// The image is 16 MB, mostly zeros (program blocks, then the document area at $00800000): gzipped it is
// about 200 KB, and the emulator unpacks it in the browser with DecompressionStream. The .gz is rewritten
// only when the image content changes, so the same image never makes a new commit.
// Make the image with "python3 update_sd.py --mode full" in bo6502-SDbuilder; do not edit it here.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'public', 'sd_full.img.gz');

const args = process.argv.slice(2);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const check = args.includes('--check');

try {
  const source = opt('--source') ?? process.env.MINIVIC_SD_FULL ?? join(ROOT, '..', 'bo6502-SDbuilder', 'sd_full.img');
  if (!existsSync(source)) throw new Error(`image not found: ${source} (use --source)`);
  const img = readFileSync(source);
  if (img.length < 0x01000000 || img.length % 512) throw new Error(`${source}: ${img.length} bytes, expected at least 16 MB`);
  if (img.subarray(0, 4).toString('latin1') !== 'BOGS') throw new Error(`${source}: no "BOGS" directory, not made by make_sd.py`);
  const changed = !existsSync(DEST) || !gunzipSync(readFileSync(DEST)).equals(img);
  if (changed && !check) writeFileSync(DEST, gzipSync(img, { level: 9 }));
  console.log(!changed ? `Full SD already in sync (${img[15]} programs).`
    : `${check ? 'There are differences' : 'Full SD packed'}: public/sd_full.img.gz (${img[15]} programs)`);
  process.exit(check && changed ? 2 : 0);
} catch (e) {
  console.error(`pack-sd-full: ${e.message}`);
  process.exit(1);
}
