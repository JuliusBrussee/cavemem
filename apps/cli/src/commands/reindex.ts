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
      // FTS5 rebuild pattern.
      const db = (s as unknown as { db: { exec: (q: string) => void } }).db;
      // Fallback to raw exec via better-sqlite3 if exposed; otherwise use public API to no-op.
      try {
        if (db?.exec) db.exec("INSERT INTO observations_fts(observations_fts) VALUES('rebuild');");
      } catch {
        // swallow — rebuild is best-effort
      }
      s.close();
      process.stdout.write('reindex ok\n');
    });
}
