import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compress, countTokens } from '@cavemem/compress';

const corpusDir = join(import.meta.dirname, '..', 'corpus');
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.md'));

let totalBefore = 0;
let totalAfter = 0;
const rows: Array<[string, number, number, number]> = [];

for (const f of files) {
  const text = readFileSync(join(corpusDir, f), 'utf8');
  const before = countTokens(text);
  const afterFull = countTokens(compress(text, { intensity: 'full' }));
  totalBefore += before;
  totalAfter += afterFull;
  rows.push([f, before, afterFull, Math.round(((before - afterFull) / before) * 100)]);
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
process.stdout.write(
  `${pad('file', 32)}${pad('before', 10)}${pad('after', 10)}${pad('saved%', 10)}\n`,
);
for (const [f, b, a, s] of rows) {
  process.stdout.write(
    `${pad(f, 32)}${pad(String(b), 10)}${pad(String(a), 10)}${pad(`${s}%`, 10)}\n`,
  );
}
process.stdout.write(
  `\nTOTAL before=${totalBefore} after=${totalAfter} saved=${Math.round(((totalBefore - totalAfter) / totalBefore) * 100)}%\n`,
);
