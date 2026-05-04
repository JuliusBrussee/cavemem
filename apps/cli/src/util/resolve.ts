import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the cavemem CLI binary. The installer writes this into
 * IDE config files, so it must resolve correctly in both dev and installed modes.
 */
export function resolveCliPath(): string {
  const argv1 = process.argv[1];
  if (!argv1) return 'cavemem';
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

/**
 * Absolute path to the executing CLI Javascript bundle.
 * Used internally to reliably spawn the background worker daemon.
 */
export function resolveCliScriptPath(): string {
  return fileURLToPath(import.meta.url);
}
