#!/usr/bin/env node
// Prepares a self-contained publish directory for the `cavemem` npm package.
// tsup already bundles all @cavemem/* workspace code into dist/index.js, so
// the shipped package only needs the real third-party runtime deps.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'release');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Keep only the deps tsup marks as external.
const RUNTIME_DEPS = [
  'commander',
  'kleur',
  'better-sqlite3',
  'hono',
  '@hono/node-server',
  '@modelcontextprotocol/sdk',
];
const deps = Object.fromEntries(
  RUNTIME_DEPS.filter((n) => pkg.dependencies?.[n]).map((n) => [n, pkg.dependencies[n]]),
);

const shipped = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  keywords: pkg.keywords,
  license: pkg.license,
  author: pkg.author,
  homepage: pkg.homepage,
  repository: pkg.repository,
  bugs: pkg.bugs,
  engines: pkg.engines,
  type: pkg.type,
  bin: Object.fromEntries(
    Object.entries(pkg.bin).map(([k, v]) => [k, String(v).replace(/^\.\//, '')]),
  ),
  main: String(pkg.main).replace(/^\.\//, ''),
  files: ['dist', 'hooks-scripts', 'README.md', 'LICENSE'],
  dependencies: deps,
  // tsup keeps these external too (e.g. the local embedder); dropping them
  // here would ship a package that can never load the local provider.
  ...(pkg.optionalDependencies ? { optionalDependencies: pkg.optionalDependencies } : {}),
};

writeFileSync(join(out, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`);

cpSync(join(root, 'dist'), join(out, 'dist'), { recursive: true });
cpSync(join(root, '..', '..', 'hooks-scripts'), join(out, 'hooks-scripts'), { recursive: true });
cpSync(join(root, '..', '..', 'README.md'), join(out, 'README.md'));
cpSync(join(root, '..', '..', 'LICENSE'), join(out, 'LICENSE'));

process.stdout.write(`release dir ready: ${out}\n`);
