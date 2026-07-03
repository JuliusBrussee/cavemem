import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expand } from '@cavemem/compress';
import { defaultSettings } from '@cavemem/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cavemem-core-secrets-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryStore.addObservation — secret redaction (#49)', () => {
  it('scrubs secrets before compression when privacy.redactSecrets is true (default)', () => {
    const store = new MemoryStore({ dbPath: join(dir, 'a.db'), settings: defaultSettings });
    store.startSession({ id: 's1', ide: 'test', cwd: '/tmp' });
    const id = store.addObservation({
      session_id: 's1',
      kind: 'note',
      content: 'Set OPENAI_API_KEY=sk-abcdEFGH12345678ijklMNOP before running the build.',
    });
    const [row] = store.getObservations([id]);
    // Stored content (still compressed) must not contain the raw secret.
    expect(row?.content).not.toContain('sk-abcdEFGH12345678ijklMNOP');
    // Round-trip through expand() — the redaction happened before compression,
    // so it survives expansion too.
    expect(expand(row?.content ?? '')).toContain('[REDACTED]');
    expect(expand(row?.content ?? '')).not.toContain('sk-abcdEFGH12345678ijklMNOP');
    store.close();
  });

  it('leaves secrets untouched when privacy.redactSecrets is false', () => {
    const settings = {
      ...defaultSettings,
      privacy: { ...defaultSettings.privacy, redactSecrets: false },
    };
    const store = new MemoryStore({ dbPath: join(dir, 'b.db'), settings });
    store.startSession({ id: 's2', ide: 'test', cwd: '/tmp' });
    const id = store.addObservation({
      session_id: 's2',
      kind: 'note',
      content: 'Set OPENAI_API_KEY=sk-abcdEFGH12345678ijklMNOP before running the build.',
    });
    const [row] = store.getObservations([id]);
    expect(expand(row?.content ?? '')).toContain('sk-abcdEFGH12345678ijklMNOP');
    store.close();
  });
});

describe('MemoryStore.addSummary — secret redaction (#49)', () => {
  it('scrubs secrets in summaries before compression', () => {
    const store = new MemoryStore({ dbPath: join(dir, 'c.db'), settings: defaultSettings });
    store.startSession({ id: 's3', ide: 'test', cwd: '/tmp' });
    store.addSummary({
      session_id: 's3',
      scope: 'turn',
      content: 'Deployed with token: ghp_1234567890abcdefghijKLMNOPQRST as discussed.',
    });
    const [row] = store.storage.listSummaries('s3');
    expect(row?.content).not.toContain('ghp_1234567890abcdefghijKLMNOPQRST');
    expect(expand(row?.content ?? '')).toContain('[REDACTED]');
    store.close();
  });
});
