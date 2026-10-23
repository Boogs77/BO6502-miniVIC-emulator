#!/usr/bin/env node
// sync-games.mjs - porta nell'emulatore i giochi del progetto miniVIC_games
//
//   node scripts/sync-games.mjs            copia i giochi nuovi o cambiati e rigenera src/machines/games.ts
//   node scripts/sync-games.mjs --check    solo controllo: exit 0 = allineati, 2 = ci sono differenze
//   node scripts/sync-games.mjs --check --hook
//                                          come --check, ma stampa un avviso solo se ci sono novita'
//                                          (per l'hook SessionStart di Claude Code) ed esce sempre con 0
//   --source <cartella>                    cartella del progetto dei giochi (default: MINIVIC_GAMES_DIR,
//                                          poi "../MiniVIC Games" accanto a questo repository)
//   --github                               legge da github.com/Boogs77/miniVIC_games invece che in locale
//   --prune                                toglie anche i giochi che non esistono piu' nella sorgente
//   --json                                 stampa il riepilogo in JSON
//
// Sorgente: bin/<gioco>.bin (caricati a $0FD0, avvio a $1000) e la tabella del README:
//   | `tank.asm` | **Tank vs Tank** | 2 | descrizione |
// L'ordine dei giochi e' quello del README; i giochi senza riga nel README vanno in fondo.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES_DIR = join(ROOT, 'public', 'games');
const GAMES_TS = join(ROOT, 'src', 'machines', 'games.ts');
const REPO = 'Boogs77/miniVIC_games';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const check = flag('--check');
const hook = flag('--hook');

const sha = data => createHash('sha1').update(data).digest('hex');

/** titoli e giocatori dalla tabella del README dei giochi */
function parseReadme(text) {
  const meta = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([\w-]+)\.asm`\s*\|\s*\*\*(.+?)\*\*\s*\|\s*([^|]+?)\s*\|/);
    if (m) meta.set(m[1], { title: m[2].trim(), players: m[3].replace(/[–—]/g, '-').trim() });
  }
  return meta;
}

/** giochi della sorgente: [{ name, data, title, players }] nell'ordine del README */
async function readSource() {
  let readme = '';
  const bins = new Map();
  if (flag('--github')) {
    const api = `https://api.github.com/repos/${REPO}/contents`;
    const headers = { 'User-Agent': 'bo6502-emulator-sync' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const list = await (await fetch(`${api}/bin`, { headers })).json();
    if (!Array.isArray(list)) throw new Error(`GitHub: ${list.message ?? 'risposta inattesa'}`);
    for (const f of list.filter(f => f.name.endsWith('.bin'))) {
      const r = await fetch(f.download_url, { headers });
      bins.set(f.name.replace(/\.bin$/, ''), new Uint8Array(await r.arrayBuffer()));
    }
    readme = await (await fetch(`https://raw.githubusercontent.com/${REPO}/main/README.md`, { headers })).text();
  } else {
    const src = opt('--source') ?? process.env.MINIVIC_GAMES_DIR ?? join(ROOT, '..', 'MiniVIC Games');
    if (!existsSync(join(src, 'bin'))) throw new Error(`cartella dei giochi non trovata: ${src} (usa --source o --github)`);
    for (const f of readdirSync(join(src, 'bin')).filter(f => f.endsWith('.bin'))) {
      bins.set(f.replace(/\.bin$/, ''), new Uint8Array(readFileSync(join(src, 'bin', f))));
    }
    if (existsSync(join(src, 'README.md'))) readme = readFileSync(join(src, 'README.md'), 'utf8');
  }
  const meta = parseReadme(readme);
  const order = [...meta.keys()].filter(n => bins.has(n));
  const rest = [...bins.keys()].filter(n => !meta.has(n)).sort();
  return [...order, ...rest].map(name => ({
    name,
    data: bins.get(name),
    title: meta.get(name)?.title ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    players: meta.get(name)?.players ?? '1',
  }));
}

/** giochi attuali dell'emulatore (da games.ts) */
function readCurrent() {
  const text = existsSync(GAMES_TS) ? readFileSync(GAMES_TS, 'utf8') : '';
  const list = [];
  for (const m of text.matchAll(/\{\s*file:\s*'([\w-]+)\.bin',\s*title:\s*'((?:[^'\\]|\\.)*)',\s*players:\s*'([^']*)'\s*\}/g)) {
    const file = join(GAMES_DIR, `${m[1]}.bin`);
    list.push({
      name: m[1], title: m[2].replace(/\\'/g, "'"), players: m[3],
      hash: existsSync(file) ? sha(readFileSync(file)) : null,
    });
  }
  return list;
}

function renderGamesTs(games) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `// Giochi miniVIC inclusi (public/games, da github.com/${REPO})
// Ogni .bin parte da $0FD0 (trampolino NMI) e il programma da $1000.
// Elenco generato da scripts/sync-games.mjs: si aggiorna con la skill sync-minivic-games.

export interface GameInfo {
  file: string;
  title: string;
  players: string;
}

export const GAMES: GameInfo[] = [
${games.map(g => `  { file: '${g.name}.bin', title: '${esc(g.title)}', players: '${esc(g.players)}' },`).join('\n')}
];

export const GAME_LOAD = 0x0FD0;
export const GAME_ENTRY = 0x1000;
`;
}

async function main() {
  const source = await readSource();
  const current = readCurrent();
  const cur = new Map(current.map(g => [g.name, g]));
  const src = new Map(source.map(g => [g.name, g]));

  const added = source.filter(g => !cur.has(g.name));
  const updated = source.filter(g => cur.has(g.name) && cur.get(g.name).hash !== sha(g.data));
  const renamed = source.filter(g => cur.has(g.name) &&
    (cur.get(g.name).title !== g.title || cur.get(g.name).players !== g.players));
  const missing = current.filter(g => !src.has(g.name));
  const removed = flag('--prune') ? missing : [];

  // ordine finale: quello della sorgente; i giochi tolti dalla sorgente restano in fondo (se non --prune)
  const final = [...source, ...missing.filter(g => !removed.includes(g))];
  const changed = added.length + updated.length + renamed.length + removed.length > 0 ||
    final.map(g => g.name).join() !== current.map(g => g.name).join();

  const summary = {
    changed,
    added: added.map(g => `${g.name} (${g.title})`),
    updated: updated.map(g => g.name),
    renamed: renamed.map(g => `${g.name}: ${g.title}, ${g.players} gioc.`),
    removed: removed.map(g => g.name),
    onlyInEmulator: missing.filter(g => !removed.includes(g)).map(g => g.name),
    total: final.length,
  };

  if (!check && changed) {
    mkdirSync(GAMES_DIR, { recursive: true });
    for (const g of [...added, ...updated]) writeFileSync(join(GAMES_DIR, `${g.name}.bin`), g.data);
    for (const g of removed) {
      const f = join(GAMES_DIR, `${g.name}.bin`);
      if (existsSync(f)) unlinkSync(f);
    }
    writeFileSync(GAMES_TS, renderGamesTs(final));
  }

  if (flag('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (hook) {
    if (changed) {
      console.log(`Giochi miniVIC da sincronizzare nell'emulatore: ` +
        [summary.added.length && `nuovi ${summary.added.join(', ')}`,
         summary.updated.length && `aggiornati ${summary.updated.join(', ')}`,
         summary.renamed.length && `dati cambiati ${summary.renamed.join('; ')}`]
          .filter(Boolean).join(' - ').replace(/\.$/, '') +
        `. Usa la skill sync-minivic-games per aggiornarli.`);
    }
  } else {
    const line = (label, list) => list.length && console.log(`${label}: ${list.join(', ')}`);
    if (!changed) console.log(`Giochi gia' allineati (${summary.total}).`);
    else console.log(check ? 'Ci sono differenze:' : `Giochi sincronizzati (${summary.total}):`);
    line('  nuovi', summary.added);
    line('  aggiornati', summary.updated);
    line('  titolo/giocatori cambiati', summary.renamed);
    line('  tolti', summary.removed);
    line('  solo nell\'emulatore (non tolti, usa --prune)', summary.onlyInEmulator);
  }
  process.exit(check && changed && !hook ? 2 : 0);
}

main().catch(e => {
  if (hook) process.exit(0); // l'hook non deve mai bloccare l'avvio della sessione
  console.error(`sync-games: ${e.message}`);
  process.exit(1);
});
