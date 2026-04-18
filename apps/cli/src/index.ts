import { Command } from 'commander';
import { registerCompressCommands } from './commands/compress.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerExportCommand } from './commands/export.js';
import { registerHookCommand } from './commands/hook.js';
import { registerInstallCommand } from './commands/install.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerReindexCommand } from './commands/reindex.js';
import { registerSearchCommand } from './commands/search.js';
import { registerUninstallCommand } from './commands/uninstall.js';
import { registerWorkerCommand } from './commands/worker.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('cavemem')
    .description('Cross-agent persistent memory with compressed storage.')
    .version('0.1.0');

  registerInstallCommand(program);
  registerUninstallCommand(program);
  registerDoctorCommand(program);
  registerWorkerCommand(program);
  registerMcpCommand(program);
  registerSearchCommand(program);
  registerCompressCommands(program);
  registerExportCommand(program);
  registerHookCommand(program);
  registerReindexCommand(program);

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      process.stderr.write(`cavemem error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
