import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const LEGACY_DIR_NAME = '.cavemem';

export function resolveDataDir(raw: string): string {
  if (raw.startsWith('~')) return join(homedir(), raw.slice(1).replace(/^\/+/, ''));
  return resolve(raw);
}

let cachedHome: string | undefined;

/**
 * Resolve the cavemem home directory — where settings.json, data.db, and all
 * other state live unless `dataDir` overrides the data location specifically
 * (see schema.ts). Resolution order (issue #47):
 *   1. `CAVEMEM_HOME`, if set — used verbatim (directories are created lazily
 *      by whatever writes into them first, e.g. `saveSettings` / `Storage`).
 *   2. An existing `~/.cavemem` — zero breaking change for current installs.
 *   3. `XDG_DATA_HOME` (or, on Linux with no XDG var, the XDG default
 *      `~/.local/share`) for new installs on Linux. macOS/Windows without an
 *      explicit XDG var keep `~/.cavemem`.
 *
 * Pure fs.existsSync checks only (no globbing) and cached for the life of the
 * process — hook handlers and the worker call this on the hot path.
 */
export function resolveCavememHome(): string {
  if (cachedHome !== undefined) return cachedHome;
  cachedHome = computeCavememHome();
  return cachedHome;
}

function computeCavememHome(): string {
  const envHome = process.env.CAVEMEM_HOME;
  if (envHome) return resolveDataDir(envHome);

  const legacy = join(homedir(), LEGACY_DIR_NAME);
  if (existsSync(legacy)) return legacy;

  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) return join(resolveDataDir(xdgDataHome), 'cavemem');
  if (process.platform === 'linux') return join(homedir(), '.local', 'share', 'cavemem');

  return legacy;
}
