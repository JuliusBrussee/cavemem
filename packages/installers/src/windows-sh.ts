import { spawnSync } from 'node:child_process';

// Claude Code wraps hook `command` strings in `sh -c` on Windows (#56). If
// Git for Windows' `Git\bin` isn't on the user PATH, `sh` doesn't resolve,
// every hook fails non-blocking, and cavemem silently stops capturing —
// `doctor`/`status` keep reporting healthy because the failure never
// reaches the CLI. Plain text (no ANSI) so callers can color it and tests
// can assert on substrings.
export const WINDOWS_SH_MISSING_WARNING = [
  '`sh` not found on PATH.',
  'Claude Code runs hook commands through `sh -c` even on Windows. Without `sh`,',
  'every hook fails silently and cavemem stops capturing memory — `doctor` and',
  '`status` will still look healthy.',
  '',
  "fix (one time): add Git for Windows' bin dir to your user Path:",
  '  C:\\Program Files\\Git\\bin           (default Git for Windows install)',
  '  <scoop dir>\\apps\\git\\current\\usr\\bin   (Scoop install)',
  '',
  'verify with: where.exe sh',
].join('\n');

/** Real check: does `sh -c "exit 0"` actually start? Used unless a test injects a fake. */
export function resolveShDefault(): boolean {
  try {
    const result = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore', windowsHide: true });
    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

export interface CheckWindowsShOptions {
  /** Defaults to `process.platform`. Injectable so non-Windows CI can exercise the win32 branch. */
  platform?: NodeJS.Platform;
  /** Defaults to `resolveShDefault`. Injectable so tests don't shell out. */
  resolveSh?: () => boolean;
}

/**
 * Returns the warning text if `sh` is missing on win32, or `null` if `sh`
 * resolves or the platform isn't win32 (skipped silently everywhere else).
 */
export function checkWindowsSh(options: CheckWindowsShOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return null;
  const resolveSh = options.resolveSh ?? resolveShDefault;
  return resolveSh() ? null : WINDOWS_SH_MISSING_WARNING;
}
