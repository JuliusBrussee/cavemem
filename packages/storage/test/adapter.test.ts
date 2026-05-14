import { describe, expect, it } from 'vitest';
import { normalizeBunGet, sanitizeMatch, isBun } from '../src/storage.js';

describe('sanitizeMatch', () => {
  it('wraps each term in double quotes', () => {
    expect(sanitizeMatch('auth token')).toBe('"auth" "token"');
  });

  it('escapes embedded double quotes', () => {
    expect(sanitizeMatch('say "hello"')).toBe('"say" """hello"""');
  });

  it('collapses extra whitespace', () => {
    expect(sanitizeMatch('  foo   bar  ')).toBe('"foo" "bar"');
  });

  it('returns empty string for blank input', () => {
    expect(sanitizeMatch('')).toBe('');
    expect(sanitizeMatch('   ')).toBe('');
  });

  it('handles single term', () => {
    expect(sanitizeMatch('middleware')).toBe('"middleware"');
  });
});

describe('normalizeBunGet', () => {
  it('converts null to undefined', () => {
    expect(normalizeBunGet(null)).toBeUndefined();
  });

  it('passes through a matching row unchanged', () => {
    const row = { id: 1, content: 'x' };
    expect(normalizeBunGet(row)).toBe(row);
  });

  it('passes through undefined unchanged', () => {
    expect(normalizeBunGet(undefined)).toBeUndefined();
  });

  it('passes through 0 and false without coercing to undefined', () => {
    expect(normalizeBunGet(0)).toBe(0);
    expect(normalizeBunGet(false)).toBe(false);
  });
});

describe('isBun', () => {
  it('is false when running under Node (CI path always takes better-sqlite3)', () => {
    // Verifies the Node path (better-sqlite3) is taken in CI.
    // If this breaks, bun:sqlite is being loaded unexpectedly.
    expect(isBun).toBe(false);
  });
});
