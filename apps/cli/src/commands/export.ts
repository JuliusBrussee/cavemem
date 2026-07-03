import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, resolveDataDir } from '@cavemem/config';
import { Storage } from '@cavemem/storage';
import type { Command } from 'commander';
import kleur from 'kleur';

export function registerExportCommand(program: Command): void {
  program
    .command('export <out>')
    .description('Export memory to JSONL')
    .action(async (out: string) => {
      const settings = loadSettings();
      const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
      try {
        const { records } = exportJsonl(dbPath, out);
        process.stdout.write(`wrote ${out} (${records} records)\n`);
      } catch (err) {
        process.stderr.write(
          `${kleur.red('cavemem export:')} ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = 1;
      }
    });

  program
    .command('import <file>')
    .description('Import memory from a cavemem export JSONL file')
    .option('--dry-run', 'validate and report counts without writing')
    .action(async (file: string, opts: { dryRun?: boolean }) => {
      const settings = loadSettings();
      const dbPath = join(resolveDataDir(settings.dataDir), 'data.db');
      let counts: ImportCounts;
      try {
        counts = importJsonl(dbPath, file, { dryRun: Boolean(opts.dryRun) });
      } catch (err) {
        process.stderr.write(
          `${kleur.red('cavemem import:')} ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = 1;
        return;
      }

      const synth =
        counts.sessionsSynthesized > 0 ? `, ${counts.sessionsSynthesized} synthesized` : '';
      const summary =
        `${counts.sessionsImported} sessions (${counts.sessionsSkipped} skipped${synth}), ` +
        `${counts.observationsImported} observations (${counts.observationsSkipped} skipped, ` +
        `${counts.observationsReassigned} reassigned)`;
      if (opts.dryRun) {
        process.stdout.write(`${kleur.yellow('dry-run:')} would import ${summary}\n`);
      } else {
        process.stdout.write(`${kleur.green('imported')} ${summary}\n`);
      }
    });
}

/** Dump every session + observation in `dbPath` to `outFile` as JSONL. */
export function exportJsonl(dbPath: string, outFile: string): { records: number } {
  // Fail with a readable message instead of the driver's SQLITE_CANTOPEN.
  if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath} — nothing to export`);
  const s = new Storage(dbPath, { readonly: true });
  const lines: string[] = [];
  for (const sess of s.listSessions(10000)) {
    lines.push(JSON.stringify({ type: 'session', ...sess }));
    for (const o of s.timeline(sess.id, undefined, 10000)) {
      lines.push(JSON.stringify({ type: 'observation', ...o }));
    }
  }
  writeFileSync(outFile, lines.join('\n'));
  s.close();
  return { records: lines.length };
}

export interface ImportCounts {
  sessionsImported: number;
  sessionsSkipped: number;
  sessionsSynthesized: number;
  observationsImported: number;
  observationsSkipped: number;
  observationsReassigned: number;
}

/**
 * Import a `cavemem export` JSONL file into `dbPath`.
 *
 * Every line is parsed and shape-validated before any database is opened —
 * a bad line anywhere in the file throws immediately with nothing written.
 * The actual writes then run inside one SQLite transaction (`--dry-run`
 * throws a sentinel at the end of that transaction so it rolls back and
 * nothing is persisted, while still exercising the real insert path).
 *
 * Merge semantics: sessions merge by id (already-present ids are skipped).
 * Observations carry per-machine AUTOINCREMENT ids, so
 * `Storage.importObservation` treats the exported id as a preference, not
 * an identity: exact (session_id, ts, content) duplicates are skipped, a
 * free id is used as-is, and an id occupied by a *different* observation
 * gets a fresh AUTOINCREMENT id ("reassigned") — nothing is overwritten,
 * and re-running the same import stays a no-op. Observation content is
 * written verbatim rather than through `MemoryStore`, because it already
 * passed through `@cavemem/compress` on the exporting machine —
 * recompressing it here could change the bytes if the target's
 * `compression.intensity` setting differs, which would break
 * byte-identical round-trips.
 */
export function importJsonl(
  dbPath: string,
  file: string,
  opts: { dryRun?: boolean } = {},
): ImportCounts {
  const raw = readFileSync(file, 'utf8');

  const records: ImportRecord[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      records.push(parseImportLine(line));
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A dry run must not leave an empty data.db behind. When the target
  // database doesn't exist yet, run the identical write path against an
  // in-memory database instead — semantically the same as importing into a
  // fresh dataDir, with nothing touching disk.
  const target = opts.dryRun && !existsSync(dbPath) ? ':memory:' : dbPath;
  const s = new Storage(target);
  const counts: ImportCounts = {
    sessionsImported: 0,
    sessionsSkipped: 0,
    sessionsSynthesized: 0,
    observationsImported: 0,
    observationsSkipped: 0,
    observationsReassigned: 0,
  };

  try {
    s.transaction(() => {
      for (const rec of records) {
        if (rec.type === 'session') {
          const inserted = s.createSession({
            id: rec.id,
            ide: rec.ide,
            cwd: rec.cwd,
            started_at: rec.started_at,
            metadata: rec.metadata,
          });
          if (inserted) {
            counts.sessionsImported++;
            if (rec.ended_at !== null) s.endSession(rec.id, rec.ended_at);
          } else {
            counts.sessionsSkipped++;
          }
        } else {
          // Export always emits a session's record before its observations,
          // so this session row is normally already there. Synthesize a
          // minimal one as a defensive fallback for hand-edited or
          // truncated files, so a valid observation isn't rejected by the
          // observations.session_id foreign key.
          if (!s.getSession(rec.session_id)) {
            const created = s.createSession({
              id: rec.session_id,
              ide: 'unknown',
              cwd: null,
              started_at: rec.ts,
              metadata: null,
            });
            if (created) counts.sessionsSynthesized++;
          }
          const outcome = s.importObservation({
            id: rec.id,
            session_id: rec.session_id,
            kind: rec.kind,
            content: rec.content,
            compressed: rec.compressed,
            intensity: rec.intensity,
            ts: rec.ts,
            metadata: rec.metadata,
          });
          if (outcome === 'inserted') counts.observationsImported++;
          else if (outcome === 'reassigned') counts.observationsReassigned++;
          else counts.observationsSkipped++;
        }
      }
      if (opts.dryRun) throw new DryRunComplete();
    });
  } catch (err) {
    if (!(err instanceof DryRunComplete)) throw err;
  } finally {
    s.close();
  }

  return counts;
}

/** Thrown deliberately to unwind (and roll back) a --dry-run transaction. */
class DryRunComplete extends Error {}

interface ImportSessionRecord {
  type: 'session';
  id: string;
  ide: string;
  cwd: string | null;
  started_at: number;
  ended_at: number | null;
  metadata: string | null;
}

interface ImportObservationRecord {
  type: 'observation';
  id: number;
  session_id: string;
  kind: string;
  content: string;
  compressed: 0 | 1;
  intensity: string | null;
  ts: number;
  metadata: string | null;
}

type ImportRecord = ImportSessionRecord | ImportObservationRecord;

/** Parse and shape-validate one JSONL line from a cavemem export file. */
function parseImportLine(line: string): ImportRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new Error(`invalid JSON — ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('not a JSON object');
  }
  const r = parsed as Record<string, unknown>;

  if (r.type === 'session') {
    if (typeof r.id !== 'string') throw new Error('session record missing string "id"');
    if (typeof r.ide !== 'string') throw new Error('session record missing string "ide"');
    if (typeof r.started_at !== 'number') {
      throw new Error('session record missing numeric "started_at"');
    }
    return {
      type: 'session',
      id: r.id,
      ide: r.ide,
      cwd: typeof r.cwd === 'string' ? r.cwd : null,
      started_at: r.started_at,
      ended_at: typeof r.ended_at === 'number' ? r.ended_at : null,
      metadata: typeof r.metadata === 'string' ? r.metadata : null,
    };
  }

  if (r.type === 'observation') {
    if (typeof r.id !== 'number') throw new Error('observation record missing numeric "id"');
    if (typeof r.session_id !== 'string') {
      throw new Error('observation record missing string "session_id"');
    }
    if (typeof r.kind !== 'string') throw new Error('observation record missing string "kind"');
    if (typeof r.content !== 'string') {
      throw new Error('observation record missing string "content"');
    }
    if (typeof r.ts !== 'number') throw new Error('observation record missing numeric "ts"');
    return {
      type: 'observation',
      id: r.id,
      session_id: r.session_id,
      kind: r.kind,
      content: r.content,
      compressed: r.compressed === 1 || r.compressed === true ? 1 : 0,
      intensity: typeof r.intensity === 'string' ? r.intensity : null,
      ts: r.ts,
      metadata: typeof r.metadata === 'string' ? r.metadata : null,
    };
  }

  throw new Error(
    `unknown record type ${JSON.stringify(r.type)} — expected "session" or "observation"`,
  );
}
