#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { registerCompressCommands } from './commands/compress.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerExportCommand } from './commands/export.js';
import { registerHookCommand } from './commands/hook.js';
import { registerInstallCommand } from './commands/install.js';
import { registerLifecycleCommands } from './commands/lifecycle.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerReindexCommand } from './commands/reindex.js';
import { registerSearchCommand } from './commands/search.js';
import { registerStatusCommand } from './commands/status.js';
import { registerUninstallCommand } from './commands/uninstall.js';
import { registerWorkerCommand } from './commands/worker.js';

declare const __CAVEMEM_VERSION__: string;
const VERSION = typeof __CAVEMEM_VERSION__ !== 'undefined' ? __CAVEMEM_VERSION__ : '0.0.0';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('cavemem')
    .description('Cross-agent persistent memory with compressed storage.')
    .version(VERSION);

  registerInstallCommand(program);
  registerUninstallCommand(program);
  registerStatusCommand(program);
  registerConfigCommand(program);
  registerDoctorCommand(program);
  registerLifecycleCommands(program);
  registerWorkerCommand(program);
  registerMcpCommand(program);
  registerSearchCommand(program);
  registerCompressCommands(program);
  registerExportCommand(program);
  registerHookCommand(program);
  registerReindexCommand(program);

  return program;
}

if (isMainEntry()) {
  // When stdout is piped to a consumer that exits early (e.g. `| head`, `| grep -q`),
  // further writes raise EPIPE. Node turns that into an uncaught exception by default,
  // which is noisy and misleading for what is really a successful upstream-terminated pipe.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
  createProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      process.stderr.write(`cavemem error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}

/**
 * Detects whether this module is the process entrypoint. The naive
 * `import.meta.url === file://${process.argv[1]}` check is wrong when the
 * binary is invoked through an npm-installed symlink, because argv[1] is the
 * symlink path while import.meta.url resolves to the real file.
 */
function isMainEntry(): boolean {
  const argv = process.argv[1];
  if (!argv) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv)).href;
  } catch {
    return import.meta.url === pathToFileURL(argv).href;
  }
}
