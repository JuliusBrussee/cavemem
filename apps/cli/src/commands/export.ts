import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { Storage } from '@cavemem/storage';
import type { Command } from 'commander';

export function registerExportCommand(program: Command): void {
  program
    .command('export <out>')
    .description('Export memory to JSONL')
    .action(async (out: string) => {
      const settings = loadSettings();
      const s = new Storage(join(resolveDataDir(settings.dataDir), 'data.db'), {
        readonly: true,
      });
      const lines: string[] = [];
      for (const sess of s.listSessions(10000)) {
        lines.push(JSON.stringify({ type: 'session', ...sess }));
        for (const o of s.timeline(sess.id, undefined, 10000)) {
          lines.push(JSON.stringify({ type: 'observation', ...o }));
        }
      }
      writeFileSync(out, lines.join('\n'));
      s.close();
      process.stdout.write(`wrote ${out} (${lines.length} records)\n`);
    });

  program
    .command('import <in>')
    .description('Import memory from JSONL')
    .action(async (file: string) => {
      const settings = loadSettings();
      const s = new Storage(join(resolveDataDir(settings.dataDir), 'data.db'));
      const lines = readFileSync(file, 'utf8').split(/\n+/).filter(Boolean);
      let n = 0;
      for (const line of lines) {
        const rec = JSON.parse(line) as { type: string } & Record<string, unknown>;
        if (rec.type === 'session') {
          s.createSession({
            id: String(rec.id),
            ide: String(rec.ide),
            cwd: (rec.cwd as string | null) ?? null,
            started_at: Number(rec.started_at),
            metadata: (rec.metadata as string | null) ?? null,
          });
          n++;
        } else if (rec.type === 'observation') {
          s.insertObservation({
            session_id: String(rec.session_id),
            kind: String(rec.kind),
            content: String(rec.content),
            compressed: rec.compressed === 1 || rec.compressed === true,
            intensity: (rec.intensity as string | null) ?? null,
            ts: Number(rec.ts),
          });
          n++;
        }
      }
      s.close();
      process.stdout.write(`imported ${n} records\n`);
    });
}
