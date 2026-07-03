import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesGlob } from '../src/index.js';

describe('globToRegExp', () => {
  it('matches "**/x" against both a bare name and a nested path', () => {
    const re = globToRegExp('**/.env');
    expect(re.test('.env')).toBe(true);
    expect(re.test('/a/b/.env')).toBe(true);
    expect(re.test('a/b/.env')).toBe(true);
  });

  it('does not match a partial segment', () => {
    const re = globToRegExp('**/.env');
    expect(re.test('notdotenv')).toBe(false);
    expect(re.test('.env.example')).toBe(false);
    expect(re.test('/a/.envfile')).toBe(false);
  });

  it('matches "**/dir/**" against nested contents', () => {
    const re = globToRegExp('**/secrets/**');
    expect(re.test('secrets/x')).toBe(true);
    expect(re.test('/a/secrets/b/c')).toBe(true);
    expect(re.test('nested/secrets/inner/file.txt')).toBe(true);
  });

  it('does not match a directory name that merely contains the segment', () => {
    const re = globToRegExp('**/secrets/**');
    expect(re.test('notsecrets/x')).toBe(false);
    expect(re.test('my-secrets-dir/x')).toBe(false);
  });

  it('"*" matches within a segment but not across "/"', () => {
    const re = globToRegExp('*.env');
    expect(re.test('local.env')).toBe(true);
    expect(re.test('a/local.env')).toBe(false);
  });

  it('escapes regex-special characters in literal segments', () => {
    const re = globToRegExp('config.json');
    expect(re.test('config.json')).toBe(true);
    expect(re.test('configXjson')).toBe(false);
  });

  it('supports tool-name globs like "mcp__broker__*"', () => {
    const re = globToRegExp('mcp__broker__*');
    expect(re.test('mcp__broker__send')).toBe(true);
    expect(re.test('mcp__other__send')).toBe(false);
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
