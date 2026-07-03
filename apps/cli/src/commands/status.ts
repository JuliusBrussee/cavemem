import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, resolveDataDir, settingsPath } from '@cavemem/config';
import { type IdeName, installers } from '@cavemem/installers';
import { Storage } from '@cavemem/storage';
import type { Command } from 'commander';
import kleur from 'kleur';

interface WorkerState {
  provider?: string;
  model?: string;
  dim?: number;
  embedded?: number;
  total?: number;
  lastBatchAt?: number | null;
  lastBatchMs?: number | null;
  lastError?: string | null;
  startedAt?: number;
}

function readWorkerState(dir: string): WorkerState | null {
  const p = join(dir, 'worker.state.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as WorkerState;
  } catch {
    return null;
  }
}

function readPid(dir: string): number | null {
  const p = join(dir, 'worker.pid');
  if (!existsSync(p)) return null;
  const n = Number(readFileSync(p, 'utf8').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// #58: `cavemem status` used to list installed IDEs with no indication that
// some (e.g. antigravity, bob) never capture new observations — they only
// expose MCP query access over memory captured elsewhere. Annotate those so
// the gap is visible instead of discovered by an empty DB.
export function annotateIde(name: string): string {
  const installer = installers[name as IdeName];
  return installer?.capture === 'none' ? `${name} (query-only)` : name;
}

function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return kleur.dim('never');
  const ms = Date.now() - ts;
  if (ms < 1000) return `${ms}ms ago`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show cavemem wiring, data, and worker state')
    .action(() => {
      const sp = settingsPath();
      const settings = loadSettings();
      const dir = resolveDataDir(settings.dataDir);
      const dbPath = join(dir, 'data.db');

      process.stdout.write(`${kleur.bold('cavemem status')}\n\n`);
      process.stdout.write(
        `settings:   ${sp} ${existsSync(sp) ? kleur.green('✓') : kleur.yellow('default')}\n`,
      );
      process.stdout.write(`data dir:   ${dir}\n`);

      // DB
      let obsCount = 0;
      let sessCount = 0;
      try {
        const s = new Storage(dbPath);
        obsCount = s.countObservations();
        sessCount = s.listSessions(10_000).length;
        s.close();
        process.stdout.write(
          `db:         ${dbPath} ${kleur.green('✓')} (${obsCount} observations, ${sessCount} sessions)\n`,
        );
      } catch (err) {
        process.stdout.write(`db:         ${dbPath} ${kleur.red('fail')} ${String(err)}\n`);
        process.exitCode = 1;
      }

      // IDEs
      const enabled = Object.entries(settings.ides)
        .filter(([, v]) => v)
        .map(([k]) => k);
      process.stdout.write(
        `ides:       ${enabled.length ? enabled.map(annotateIde).join(', ') : kleur.dim('none installed — try `cavemem install`')}\n`,
      );

      // Embedding
      const state = readWorkerState(dir);
      const provider = settings.embedding.provider;
      const model = settings.embedding.model;
      process.stdout.write(`embedding:  ${provider} / ${model}\n`);
      if (provider === 'none') {
        process.stdout.write(`backfill:   ${kleur.dim('disabled (provider=none)')}\n`);
      } else if (state) {
        const embedded = state.embedded ?? 0;
        const total = state.total ?? obsCount;
        const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
        const colour = pct === 100 ? kleur.green : pct > 0 ? kleur.yellow : kleur.dim;
        process.stdout.write(
          `backfill:   ${colour(`${embedded} / ${total}`)} (${pct}%)  last batch ${fmtAgo(state.lastBatchAt)}\n`,
        );
        if (state.lastError) {
          process.stdout.write(`  ${kleur.red('error:')} ${state.lastError}\n`);
        }
      } else {
        process.stdout.write(
          `backfill:   ${kleur.dim('no worker state yet — run `cavemem start`')}\n`,
        );
      }

      // Worker
      const pid = readPid(dir);
      if (pid && isAlive(pid)) {
        const uptime = state?.startedAt ? fmtAgo(state.startedAt).replace(' ago', '') : '?';
        process.stdout.write(
          `worker:     ${kleur.green('running')} (pid ${pid}, up ${uptime})  http://127.0.0.1:${settings.workerPort}\n`,
        );
      } else if (pid) {
        process.stdout.write(`worker:     ${kleur.red('stale pidfile')} (pid ${pid})\n`);
      } else {
        process.stdout.write(
          `worker:     ${kleur.dim('not running')} — starts automatically on next hook\n`,
        );
      }
    });
}
