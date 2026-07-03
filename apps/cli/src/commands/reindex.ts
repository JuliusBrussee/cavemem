import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { Storage } from '@cavemem/storage';
import type { Command } from 'commander';

export function registerReindexCommand(program: Command): void {
  program
    .command('reindex')
    .description('Rebuild FTS index')
    .action(async () => {
      const settings = loadSettings();
      const s = new Storage(join(resolveDataDir(settings.dataDir), 'data.db'));
      try {
        s.rebuildFts();
      } catch {
        // swallow — rebuild is best-effort
      }
      s.close();
      process.stdout.write('reindex ok\n');
    });
}
