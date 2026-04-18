import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defaultSettings } from './defaults.js';
import { type Settings, SettingsSchema } from './schema.js';

const DEFAULT_DIR = '.cavemem';

export function resolveDataDir(raw: string): string {
  if (raw.startsWith('~')) return join(homedir(), raw.slice(1).replace(/^\/+/, ''));
  return resolve(raw);
}

export function settingsPath(dataDir?: string): string {
  const dir = resolveDataDir(dataDir ?? join(homedir(), DEFAULT_DIR));
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
