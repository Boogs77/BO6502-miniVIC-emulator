// run.mjs - builds the TypeScript tests with esbuild and runs them with Node
//
//   npm test              all the tests/*.test.ts files
//   npm test -- cpu       only those with "cpu" in their name
import { build } from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const filter = process.argv[2] || '';
const files = readdirSync(here).filter(f => f.endsWith('.test.ts') && f.includes(filter));

let failed = 0;
for (const f of files) {
  const outfile = join(out, f.replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [join(here, f)], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
  try {
    const mod = await import(pathToFileURL(outfile).href + '?t=' + Date.now());
    await mod.default();
    console.log(`OK    ${f}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${f}\n      ${e && e.stack || e}`);
  }
}
process.exit(failed ? 1 : 0);
