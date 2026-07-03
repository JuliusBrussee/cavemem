import { describe, expect, it } from 'vitest';
import { matchesGlob } from '../src/index.js';

const match = (value: string, pattern: string) => matchesGlob(value, [pattern]);

describe('glob matching', () => {
  it('matches "**/x" against both a bare name and a nested path', () => {
    expect(match('.env', '**/.env')).toBe(true);
    expect(match('/a/b/.env', '**/.env')).toBe(true);
    expect(match('a/b/.env', '**/.env')).toBe(true);
  });

  it('does not match a partial segment', () => {
    expect(match('notdotenv', '**/.env')).toBe(false);
    expect(match('.env.example', '**/.env')).toBe(false);
    expect(match('/a/.envfile', '**/.env')).toBe(false);
  });

  it('matches "**/dir/**" against nested contents', () => {
    expect(match('secrets/x', '**/secrets/**')).toBe(true);
    expect(match('/a/secrets/b/c', '**/secrets/**')).toBe(true);
    expect(match('nested/secrets/inner/file.txt', '**/secrets/**')).toBe(true);
  });

  it('does not match a directory name that merely contains the segment', () => {
    expect(match('notsecrets/x', '**/secrets/**')).toBe(false);
    expect(match('my-secrets-dir/x', '**/secrets/**')).toBe(false);
  });

  it('"*" matches within a segment but not across "/"', () => {
    expect(match('local.env', '*.env')).toBe(true);
    expect(match('a/local.env', '*.env')).toBe(false);
  });

  it('treats regex-special characters as literals', () => {
    expect(match('config.json', 'config.json')).toBe(true);
    expect(match('configXjson', 'config.json')).toBe(false);
  });

  it('supports tool-name globs like "mcp__broker__*"', () => {
    expect(match('mcp__broker__send', 'mcp__broker__*')).toBe(true);
    expect(match('mcp__other__send', 'mcp__broker__*')).toBe(false);
  });

  it('normalizes Windows backslash paths before matching', () => {
    expect(match('C:\\repo\\.env', '**/.env')).toBe(true);
    expect(match('C:\\repo\\secrets\\key.pem', '**/secrets/**')).toBe(true);
    expect(match('C:\\repo\\src\\index.ts', '**/.env')).toBe(false);
  });

  it('repeated globstars stay linear on slash-dense input (backtracking regression)', () => {
    const candidate = '/a'.repeat(4000); // 8000 chars — the hooks scan cap
    const t0 = performance.now();
    const matched = match(candidate, '**/**/**.log');
    const elapsed = performance.now() - t0;
    expect(matched).toBe(false);
    expect(elapsed).toBeLessThan(50);
    // Same pattern still matches when it should.
    expect(match('a/b/c.log', '**/**/**.log')).toBe(true);
  });
});

describe('matchesGlob', () => {
  it('is true when any pattern matches', () => {
    expect(matchesGlob('/repo/secrets/key.pem', ['**/.env', '**/secrets/**'])).toBe(true);
  });

  it('is false when no pattern matches', () => {
    expect(matchesGlob('/repo/src/index.ts', ['**/.env', '**/secrets/**'])).toBe(false);
  });

  it('is false for an empty pattern list', () => {
    expect(matchesGlob('/repo/.env', [])).toBe(false);
  });
});
