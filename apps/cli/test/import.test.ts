import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '@cavemem/config';
import { MemoryStore } from '@cavemem/core';
import { Storage } from '@cavemem/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportJsonl, importJsonl } from '../src/commands/export.js';

let srcDir: string;
let dstDir: string;

beforeEach(() => {
  srcDir = mkdtempSync(join(tmpdir(), 'cavemem-import-src-'));
  dstDir = mkdtempSync(join(tmpdir(), 'cavemem-import-dst-'));
});

afterEach(() => {
  rmSync(srcDir, { recursive: true, force: true });
  rmSync(dstDir, { recursive: true, force: true });
});

/** Build a small source dataset through the real compressed write path. */
function seed(dbPath: string): void {
  const store = new MemoryStore({ dbPath, settings: defaultSettings });
  store.startSession({ id: 'sess-a', ide: 'test', cwd: '/proj' });
  store.addObservation({
    session_id: 'sess-a',
    kind: 'note',
    content: 'The auth middleware throws a 401 when the session token expires.',
  });
  store.addObservation({
    session_id: 'sess-a',
    kind: 'note',
    content: 'Please add a refresh path at /src/auth/refresh.ts to fix this.',
  });
  store.endSession('sess-a');
  store.close();
}

/** Parse a JSONL export file into records, order-independent. */
function parseAndSort(file: string): unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .sort((a, b) => {
      const ka = `${a.type}:${a.id}`;
      const kb = `${b.type}:${b.id}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

describe('cavemem import', () => {
  it('round-trips export output through a fresh dataDir (content identical, modulo ordering)', () => {
    const srcDb = join(srcDir, 'data.db');
    seed(srcDb);
    const exportFile = join(srcDir, 'export.jsonl');
    exportJsonl(srcDb, exportFile);

    const dstDb = join(dstDir, 'data.db');
    const counts = importJsonl(dstDb, exportFile);
    expect(counts).toMatchObject({
      sessionsImported: 1,
      sessionsSkipped: 0,
      observationsImported: 2,
      observationsSkipped: 0,
    });

    const reExportFile = join(dstDir, 're-export.jsonl');
    exportJsonl(dstDb, reExportFile);

    expect(parseAndSort(reExportFile)).toEqual(parseAndSort(exportFile));

    // The imported content must be the exact compressed bytes from the
    // source — not re-compressed on the target — so it survives even if
    // nothing about `compress()` changes between the two calls.
    const check = new Storage(dstDb);
    const original = new Storage(srcDb, { readonly: true });
    const importedObs = check.getObservations(
      check.timeline('sess-a', undefined, 10).map((o) => o.id),
    );
    const originalObs = original.getObservations(
      original.timeline('sess-a', undefined, 10).map((o) => o.id),
    );
    expect(importedObs.map((o) => o.content).sort()).toEqual(
      originalObs.map((o) => o.content).sort(),
    );
    check.close();
    original.close();
  });

  it('is idempotent: re-importing the same file skips everything the second time', () => {
    const srcDb = join(srcDir, 'data.db');
    seed(srcDb);
    const exportFile = join(srcDir, 'export.jsonl');
    exportJsonl(srcDb, exportFile);

    const dstDb = join(dstDir, 'data.db');
    const first = importJsonl(dstDb, exportFile);
    expect(first.sessionsImported).toBeGreaterThan(0);
    expect(first.observationsImported).toBeGreaterThan(0);

    const second = importJsonl(dstDb, exportFile);
    expect(second.sessionsImported).toBe(0);
    expect(second.observationsImported).toBe(0);
    expect(second.sessionsSkipped).toBe(first.sessionsImported);
    expect(second.observationsSkipped).toBe(first.observationsImported);
  });

  it('rejects a malformed line, reports the line number, and writes nothing', () => {
    const dstDb = join(dstDir, 'data.db');
    const badFile = join(dstDir, 'bad.jsonl');
    writeFileSync(
      badFile,
      [
        JSON.stringify({
          type: 'session',
          id: 's1',
          ide: 'test',
          cwd: null,
          started_at: 1,
          ended_at: null,
          metadata: null,
        }),
        'not valid json {{{',
      ].join('\n'),
    );

    expect(() => importJsonl(dstDb, badFile)).toThrow(/line 2/);

    const check = new Storage(dstDb);
    expect(check.listSessions(10)).toHaveLength(0);
    expect(check.countObservations()).toBe(0);
    check.close();
  });

  it('--dry-run reports counts without writing anything', () => {
    const srcDb = join(srcDir, 'data.db');
    seed(srcDb);
    const exportFile = join(srcDir, 'export.jsonl');
    exportJsonl(srcDb, exportFile);

    const dstDb = join(dstDir, 'data.db');
    const counts = importJsonl(dstDb, exportFile, { dryRun: true });
    expect(counts.sessionsImported).toBe(1);
    expect(counts.observationsImported).toBe(2);

    const check = new Storage(dstDb);
    expect(check.listSessions(10)).toHaveLength(0);
    expect(check.countObservations()).toBe(0);
    check.close();

    // Running for real afterwards still imports everything — the dry run
    // left no partial state behind.
    const real = importJsonl(dstDb, exportFile);
    expect(real.sessionsImported).toBe(1);
    expect(real.observationsImported).toBe(2);
  });
});
