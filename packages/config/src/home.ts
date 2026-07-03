import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

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
 *   1. `CAVEMEM_HOME`, if set to an absolute or `~`-prefixed path (directories
 *      are created lazily by whatever writes into them first, e.g.
 *      `saveSettings` / `Storage`).
 *   2. An existing `~/.cavemem` — zero breaking change for current installs.
 *   3. `XDG_DATA_HOME/cavemem` when the var is explicitly set — on any
 *      platform. On Linux with no XDG var, the XDG default
 *      `~/.local/share/cavemem`. macOS/Windows without an explicit XDG var
 *      keep `~/.cavemem`.
 *
 * Non-absolute env values (no leading `/`, drive letter, or `~`) are ignored
 * — treated as unset, per the XDG spec. Hooks run with cwd = the project dir,
 * so a relative path would silently fragment the store per-project.
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
  const envHome = envDir('CAVEMEM_HOME');
  if (envHome) return envHome;

  const legacy = join(homedir(), LEGACY_DIR_NAME);
  if (existsSync(legacy)) return legacy;

  const xdgDataHome = envDir('XDG_DATA_HOME');
  if (xdgDataHome) return join(xdgDataHome, 'cavemem');
  if (process.platform === 'linux') return join(homedir(), '.local', 'share', 'cavemem');

  return legacy;
}

function envDir(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  if (!isAbsolute(raw) && !raw.startsWith('~')) return undefined;
  return resolveDataDir(raw);
}
