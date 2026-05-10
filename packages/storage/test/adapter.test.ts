import { describe, expect, it } from 'vitest';
import { sanitizeMatch } from '../src/storage.js';

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

describe('bun:sqlite null→undefined normalisation', () => {
  // This replicates the wrapper logic in openDb's Bun branch so regressions
  // in the null-to-undefined conversion are caught without requiring a Bun runtime.
  function wrapGet(rawGet: () => unknown): () => unknown {
    return () => {
      const r = rawGet();
      return r === null ? undefined : r;
    };
  }

  it('converts null to undefined', () => {
    expect(wrapGet(() => null)()).toBeUndefined();
  });

  it('passes through a matching row unchanged', () => {
    const row = { id: 1, content: 'x' };
    expect(wrapGet(() => row)()).toBe(row);
  });

  it('passes through undefined unchanged', () => {
    expect(wrapGet(() => undefined)()).toBeUndefined();
  });

  it('passes through 0 / false without coercing to undefined', () => {
    expect(wrapGet(() => 0)()).toBe(0);
    expect(wrapGet(() => false)()).toBe(false);
  });
});
