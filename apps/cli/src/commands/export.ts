import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { Storage } from '@cavemem/storage';
import type { Command } from 'commander';

type JsonRecord = { type: string } & Record<string, unknown>;

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
        for (const summary of s.listSummaries(sess.id)) {
          lines.push(JSON.stringify({ type: 'summary', ...summary }));
        }
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
        const rec = JSON.parse(line) as JsonRecord;
        if (rec.type === 'session') {
          const id = String(rec.id);
          s.createSession({
            id,
            ide: String(rec.ide),
            cwd: asNullableString(rec.cwd),
            started_at: Number(rec.started_at),
            metadata: asNullableString(rec.metadata),
          });
          const endedAt = asOptionalTimestamp(rec.ended_at);
          if (endedAt !== undefined) s.endSession(id, endedAt);
          n++;
        } else if (rec.type === 'summary') {
          s.insertSummary({
            session_id: String(rec.session_id),
            scope: asSummaryScope(rec.scope),
            content: String(rec.content),
            compressed: asBooleanStored(rec.compressed),
            intensity: asNullableString(rec.intensity),
            ts: Number(rec.ts),
          });
          n++;
        } else if (rec.type === 'observation') {
          const metadata = parseMetadata(rec.metadata);
          s.insertObservation({
            session_id: String(rec.session_id),
            kind: String(rec.kind),
            content: String(rec.content),
            compressed: asBooleanStored(rec.compressed),
            intensity: asNullableString(rec.intensity),
            ts: Number(rec.ts),
            ...(metadata !== undefined ? { metadata } : {}),
          });
          n++;
        }
      }
      s.close();
      process.stdout.write(`imported ${n} records\n`);
    });
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asBooleanStored(value: unknown): boolean {
  return value === 1 || value === true;
}

function asOptionalTimestamp(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const ts = Number(value);
  return Number.isFinite(ts) ? ts : undefined;
}

function asSummaryScope(value: unknown): 'turn' | 'session' {
  if (value === 'turn' || value === 'session') return value;
  throw new Error(`Invalid summary scope: ${String(value)}`);
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
