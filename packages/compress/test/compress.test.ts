import { describe, expect, it } from 'vitest';
import { compress, countTokens, expand, redactPrivate, tokenize } from '../src/index.js';

describe('tokenize preserves technical substance', () => {
  it('preserves fenced code', () => {
    const src = 'Hello\n```ts\nconst x = 1;\n```\nWorld';
    const segs = tokenize(src);
    expect(segs.some((s) => s.kind === 'fence' && s.preserved)).toBe(true);
  });
  it('preserves URLs and paths', () => {
    const src = 'See https://example.com/docs and /etc/hosts for details.';
    const segs = tokenize(src);
    expect(segs.filter((s) => s.kind === 'url').length).toBeGreaterThan(0);
    expect(segs.filter((s) => s.kind === 'path').length).toBeGreaterThan(0);
  });
  it('preserves versions and dates', () => {
    const src = 'Released 2026-04-18 as v1.2.3.';
    const segs = tokenize(src);
    expect(segs.some((s) => s.kind === 'date')).toBe(true);
    expect(segs.some((s) => s.kind === 'version')).toBe(true);
  });
});

describe('compress', () => {
  it('reduces token count on typical prose', () => {
    const src =
      'The authentication middleware is basically really important and it should be noted that we probably want to add a refresh path.';
    const out = compress(src, { intensity: 'full' });
    expect(countTokens(out)).toBeLessThan(countTokens(src));
    expect(out).not.toMatch(/basically|really|it should be noted that/i);
  });
  it('does not touch code blocks', () => {
    const src = 'The implementation is here:\n```\nconst really = 1;\n```\nand basically done.';
    const out = compress(src);
    expect(out).toContain('```\nconst really = 1;\n```');
  });
  it('does not touch URLs/paths', () => {
    const src = 'Docs at https://example.com/really and the /etc/hosts file.';
    const out = compress(src);
    expect(out).toContain('https://example.com/really');
    expect(out).toContain('/etc/hosts');
  });
  it('deterministic', () => {
    const src = 'The database configuration is the implementation detail we need.';
    expect(compress(src)).toBe(compress(src));
  });
  it('intensity ultra is stricter than lite', () => {
    const src = 'The configuration is basically really important because of the implementation.';
    const lite = compress(src, { intensity: 'lite' });
    const ultra = compress(src, { intensity: 'ultra' });
    expect(countTokens(ultra)).toBeLessThanOrEqual(countTokens(lite));
  });
});

describe('expand', () => {
  it('round-trip preserves technical tokens', () => {
    const src =
      'The config file lives at /etc/caveman.conf. See https://example.com/v1.2.3 on 2026-04-18. Run `cargo build --release`.';
    const compressed = compress(src);
    const restored = expand(compressed);
    // Technical tokens preserved in both directions.
    expect(restored).toContain('/etc/caveman.conf');
    expect(restored).toContain('https://example.com/v1.2.3');
    expect(restored).toContain('2026-04-18');
    expect(restored).toContain('`cargo build --release`');
  });
  it('expands abbreviations', () => {
    const out = expand('The db and env are set.');
    expect(out).toContain('database');
    expect(out).toContain('environment');
  });
});

describe('redactPrivate', () => {
  it('strips balanced tags', () => {
    expect(redactPrivate('before <private>secret</private> after')).toBe('before  after');
  });
  it('handles unclosed tags defensively', () => {
    expect(redactPrivate('safe <private>oops never ends')).toBe('safe ');
  });
});
