import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Settings, resolveDataDir } from '@cavemem/config';

/**
 * Ensure the worker daemon is running. Called from the hook runner after
 * every successful hook (sessionStart, postToolUse, ...) so embeddings
 * happen without the user ever typing `cavemem start`.
 *
 * Hard invariants:
 *   - Must complete in < 2 ms when the worker is already running (the hot path).
 *     We achieve this with one stat + one process.kill(pid, 0) probe.
 *   - Must never block the hook on worker start — spawn is detached + unref.
 *   - Must not spawn if CAVEMEM_NO_AUTOSTART is set (e2e tests need
 *     deterministic lifecycle).
 *   - Must not spawn if autoStart is false or provider is 'none'.
 *   - If the CLI path cannot be resolved (e.g., we're imported from a
 *     library context with no argv[1]), skip — silent no-op.
 */
export function ensureWorkerRunning(settings: Settings): void {
  if (process.env.CAVEMEM_NO_AUTOSTART) return;
  if (!settings.embedding.autoStart) return;
  if (settings.embedding.provider === 'none') return;

  const pidFile = join(resolveDataDir(settings.dataDir), 'worker.pid');
  if (existsSync(pidFile)) {
    try {
      const pid = Number(readFileSync(pidFile, 'utf8'));
      if (pid > 0 && isAlive(pid)) return;
    } catch {
      // fall through — stale or unreadable pidfile
    }
  }

  const cli = resolveCli();
  if (!cli) return;

  try {
    // Spawn `node <cli> worker start` — Windows can't exec a raw .js path
    // (EFTYPE), and `cli` is the .js entry when the hook runs through the
    // cavemem CLI. `windowsHide` suppresses the console window that
    // CreateProcess would otherwise pop for the detached child.
    const child = spawn(process.execPath, [cli, 'worker', 'start'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Best-effort — if spawn fails, the hook still succeeds. Next hook will retry.
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveCli(): string | null {
  // argv[1] is the CLI binary when the hook handler runs through `cavemem hook`.
  const argv1 = process.argv[1];
  if (argv1) return argv1;
  return null;
}
