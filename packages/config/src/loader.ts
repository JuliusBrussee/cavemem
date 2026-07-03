import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultSettings } from './defaults.js';
import { resolveCavememHome, resolveDataDir } from './home.js';
import { type Settings, SettingsSchema } from './schema.js';

export { resolveDataDir } from './home.js';

export function settingsPath(dataDir?: string): string {
  const dir = resolveDataDir(dataDir ?? resolveCavememHome());
  return join(dir, 'settings.json');
}

export function loadSettings(path?: string): Settings {
  const target = path ?? settingsPath();
  if (!existsSync(target)) return defaultSettings;
  try {
    const raw = JSON.parse(readFileSync(target, 'utf8'));
    return SettingsSchema.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid settings at ${target}: ${msg}`);
  }
}

export function saveSettings(settings: Settings, path?: string): void {
  // settings.json always lives in the resolved cavemem home — dataDir only
  // relocates the data. loadSettings reads settingsPath() with no dataDir, so
  // saving next to a custom dataDir would orphan the file where no load ever
  // looks.
  const target = path ?? settingsPath();
  // Keep the persisted file portable: the in-memory dataDir default is the
  // resolved cavemem home — an absolute, machine-specific path. Freezing it
  // into settings.json would break dotfile sync / restored backups and pin
  // the resolution order at first write, so omit the key unless the user set
  // it explicitly; loadSettings re-resolves it via the schema default.
  const { dataDir, ...rest } = settings;
  const persisted = dataDir === resolveCavememHome() ? rest : settings;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
}
