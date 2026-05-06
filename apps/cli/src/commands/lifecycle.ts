import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import type { Command } from 'commander';
import kleur from 'kleur';
import { resolveCliPath, resolveCliScriptPath } from '../util/resolve.js';

/**
 * Top-level `cavemem start|stop|restart|viewer` commands — matches the
 * ergonomic surface users expect from tools like ollama and tailscale.
 * Thin wrappers around the existing `worker start/stop` subcommands so
 * there's still a single pid-managing implementation.
 */

function pidFile(): string {
  return join(resolveDataDir(loadSettings().dataDir), 'worker.pid');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidOrPort(timeoutMs = 5000): Promise<boolean> {
  const pf = pidFile();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(pf)) {
      const pid = Number(readFileSync(pf, 'utf8'));
      if (pid > 0 && isAlive(pid)) return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function startWorker(silent = false): number | null {
  const pf = pidFile();
  if (existsSync(pf)) {
    const pid = Number(readFileSync(pf, 'utf8'));
    if (pid > 0 && isAlive(pid)) {
      if (!silent) process.stdout.write(`${kleur.yellow('already running')} (pid ${pid})\n`);
      return pid;
    }
    try {
      unlinkSync(pf);
    } catch {
      // ignore
    }
  }
  // Spawn `node <cli> worker run` so Windows doesn't try to exec a .js directly.
  const child = spawn(process.execPath, [resolveCliScriptPath(), 'worker', 'run'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
    windowsHide: true,
  });
  child.unref();
  if (child.pid) writeFileSync(pf, String(child.pid));
  return child.pid ?? null;
}

function stopWorker(): boolean {
  const pf = pidFile();
  if (!existsSync(pf)) return false;
  const pid = Number(readFileSync(pf, 'utf8'));
  try {
    process.kill(pid);
  } catch {
    // already dead
  }
  try {
    unlinkSync(pf);
  } catch {
    // ignore
  }
  return true;
}

export function registerLifecycleCommands(program: Command): void {
  program
    .command('start')
    .description('Start the worker daemon (embeddings + viewer)')
    .action(async () => {
      const pid = startWorker();
      if (pid) {
        const ready = await waitForPidOrPort();
        const port = loadSettings().workerPort;
        if (ready) {
          process.stdout.write(`${kleur.green('started')} (pid ${pid}) http://127.0.0.1:${port}\n`);
        } else {
          process.stdout.write(
            `${kleur.yellow('spawned')} (pid ${pid}) — check \`cavemem status\`\n`,
          );
        }
      }
    });

  program
    .command('stop')
    .description('Stop the worker daemon')
    .action(() => {
      if (stopWorker()) {
        process.stdout.write(`${kleur.green('stopped')}\n`);
      } else {
        process.stdout.write(`${kleur.dim('not running')}\n`);
      }
    });

  program
    .command('restart')
    .description('Restart the worker daemon')
    .action(async () => {
      stopWorker();
      // Give the old process a moment to release the port.
      await new Promise((r) => setTimeout(r, 300));
      const pid = startWorker(true);
      const ready = await waitForPidOrPort();
      const port = loadSettings().workerPort;
      if (pid && ready) {
        process.stdout.write(`${kleur.green('restarted')} (pid ${pid}) http://127.0.0.1:${port}\n`);
      } else {
        process.stdout.write(
          `${kleur.yellow('restart: unclear state')} — check \`cavemem status\`\n`,
        );
      }
    });

  program
    .command('viewer')
    .description('Open the memory viewer in your browser (auto-starts worker)')
    .action(async () => {
      startWorker(true);
      await waitForPidOrPort();
      const port = loadSettings().workerPort;
      const url = `http://127.0.0.1:${port}`;
      const cmd =
        process.platform === 'darwin'
          ? ['open', url]
          : process.platform === 'win32'
            ? ['cmd', '/c', 'start', '', url]
            : ['xdg-open', url];
      try {
        const first = cmd[0];
        if (!first) throw new Error('no opener');
        spawn(first, cmd.slice(1), { detached: true, stdio: 'ignore' }).unref();
        process.stdout.write(`${kleur.green('opening')} ${url}\n`);
      } catch {
        process.stdout.write(`${url}\n`);
      }
    });
}
