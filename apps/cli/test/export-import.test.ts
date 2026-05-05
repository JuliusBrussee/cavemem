import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@cavemem/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgram } from '../src/index.js';

let dir: string;
let oldHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-cli-export-'));
  oldHome = process.env.HOME;
  process.env.HOME = join(dir, 'home');
  mkdirSync(join(process.env.HOME, '.cavemem'), { recursive: true });
});

afterEach(() => {
  if (oldHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = oldHome;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('cavemem export/import', () => {
  it('round-trips sessions, observations, summaries, metadata, and ended_at', async () => {
    const sourceDir = join(dir, 'source');
    const targetDir = join(dir, 'target');
    writeSettings(sourceDir);

    const source = new Storage(join(sourceDir, 'data.db'));
    source.createSession({
      id: 'sess-export',
      ide: 'claude-code',
      cwd: '/repo',
      started_at: 111,
      metadata: '{"agent":"test"}',
    });
    source.insertSummary({
      session_id: 'sess-export',
      scope: 'turn',
      content: 'turn summary',
      compressed: true,
      intensity: 'full',
      ts: 222,
    });
    source.insertSummary({
      session_id: 'sess-export',
      scope: 'session',
      content: 'session summary',
      compressed: true,
      intensity: 'full',
      ts: 333,
    });
    source.insertObservation({
      session_id: 'sess-export',
      kind: 'tool_use',
      content: 'Bash listed /tmp',
      compressed: true,
      intensity: 'full',
      ts: 444,
      metadata: { tool: 'Bash', nested: { ok: true } },
    });
    source.endSession('sess-export', 555);
    source.close();

    const backup = join(dir, 'backup.jsonl');
    await createProgram().parseAsync(['node', 'cavemem', 'export', backup]);

    const exported = readJsonl(backup);
    expect(exported.map((r) => r.type)).toEqual(['session', 'summary', 'summary', 'observation']);

    writeSettings(targetDir);
    await createProgram().parseAsync(['node', 'cavemem', 'import', backup]);

    const target = new Storage(join(targetDir, 'data.db'));
    try {
      expect(target.getSession('sess-export')).toMatchObject({
        id: 'sess-export',
        ide: 'claude-code',
        cwd: '/repo',
        started_at: 111,
        ended_at: 555,
        metadata: '{"agent":"test"}',
      });
      expect(
        target
          .listSummaries('sess-export')
          .map((s) => s.content)
          .sort(),
      ).toEqual(['session summary', 'turn summary']);
      const observations = target.timeline('sess-export', undefined, 10);
      expect(observations).toHaveLength(1);
      expect(observations[0]?.metadata).toBe('{"tool":"Bash","nested":{"ok":true}}');
    } finally {
      target.close();
    }
  });

  it('imports legacy JSONL metadata strings and session timestamps', async () => {
    const targetDir = join(dir, 'legacy-target');
    const backup = join(dir, 'legacy.jsonl');
    writeFileSync(
      backup,
      [
        JSON.stringify({
          type: 'session',
          id: 'legacy',
          ide: 'codex',
          cwd: null,
          started_at: 10,
          ended_at: 20,
          metadata: null,
        }),
        JSON.stringify({
          type: 'summary',
          session_id: 'legacy',
          scope: 'turn',
          content: 'legacy summary',
          compressed: 1,
          intensity: 'full',
          ts: 30,
        }),
        JSON.stringify({
          type: 'observation',
          session_id: 'legacy',
          kind: 'tool_use',
          content: 'legacy content',
          compressed: 1,
          intensity: 'full',
          ts: 40,
          metadata: '{"tool":"Edit"}',
        }),
      ].join('\n'),
    );

    writeSettings(targetDir);
    await createProgram().parseAsync(['node', 'cavemem', 'import', backup]);

    const target = new Storage(join(targetDir, 'data.db'));
    try {
      expect(target.getSession('legacy')?.ended_at).toBe(20);
      expect(target.listSummaries('legacy')).toHaveLength(1);
      expect(target.timeline('legacy', undefined, 10)[0]?.metadata).toBe('{"tool":"Edit"}');
    } finally {
      target.close();
    }
  });
});

function writeSettings(dataDir: string): void {
  if (!process.env.HOME) throw new Error('HOME missing');
  writeFileSync(
    join(process.env.HOME, '.cavemem', 'settings.json'),
    `${JSON.stringify({ dataDir, embedding: { provider: 'none' } })}\n`,
  );
}

function readJsonl(path: string): Array<{ type: string }> {
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, 'utf8')
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string });
}
