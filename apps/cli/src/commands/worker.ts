import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import type { Command } from 'commander';
import kleur from 'kleur';
import { resolveCliPath, resolveCliScriptPath } from '../util/resolve.js';

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

export function registerWorkerCommand(program: Command): void {
  const w = program.command('worker').description('Manage local worker daemon');

  w.command('start')
    .description('Start the worker in the background')
    .action(async () => {
      const pf = pidFile();
      if (existsSync(pf)) {
        const pid = Number(readFileSync(pf, 'utf8'));
        if (isAlive(pid)) {
          process.stdout.write(`${kleur.yellow('already running')} (pid ${pid})\n`);
          return;
        }
        unlinkSync(pf);
      }
      // Spawn `node <cli> worker run` — not `<cli> worker run` — because on
      // Windows the resolved cliPath is the .js file (npm's bin shim points
      // at it), and spawn() can't execute a .js directly → EFTYPE.
      const child = spawn(process.execPath, [resolveCliScriptPath(), 'worker', 'run'], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
        windowsHide: true,
      });
      child.unref();
      writeFileSync(pf, String(child.pid));
      process.stdout.write(`${kleur.green('started')} (pid ${child.pid})\n`);
    });

  w.command('run')
    .description('Run the worker in the foreground (internal)')
    .action(async () => {
      const mod = await import('@cavemem/worker');
      await mod.start();
    });

  w.command('stop')
    .description('Stop the worker daemon')
    .action(async () => {
      const pf = pidFile();
      if (!existsSync(pf)) {
        process.stdout.write(`${kleur.dim('not running')}\n`);
        return;
      }
      const pid = Number(readFileSync(pf, 'utf8'));
      try {
        process.kill(pid);
        process.stdout.write(`${kleur.green('stopped')} (pid ${pid})\n`);
      } catch (e) {
        process.stdout.write(`${kleur.yellow('stale pidfile')} ${String(e)}\n`);
      } finally {
        unlinkSync(pf);
      }
    });

  w.command('status')
    .description('Show worker status')
    .action(async () => {
      const pf = pidFile();
      if (!existsSync(pf)) {
        process.stdout.write(`${kleur.dim('not running')}\n`);
        return;
      }
      const pid = Number(readFileSync(pf, 'utf8'));
      process.stdout.write(
        `${isAlive(pid) ? kleur.green('running') : kleur.red('dead')} (pid ${pid})\n`,
      );
    });
}
