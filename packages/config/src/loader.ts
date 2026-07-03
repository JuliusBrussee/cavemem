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
  const target = path ?? settingsPath(settings.dataDir);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
