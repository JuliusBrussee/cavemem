import { describe, expect, it } from 'vitest';
import {
  compress,
  countTokens,
  expand,
  redactPrivate,
  redactSecrets,
  tokenize,
} from '../src/index.js';

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
  it('keeps a space between prose and preserved tokens', () => {
    // Regression: collapseWhitespace used to trim trailing space off each prose
    // segment, fusing "at /tmp/out.log" into "at/tmp/out.log" when joined.
    const src = 'Run the build at /tmp/out.log using the command `pnpm build`.';
    const out = compress(src);
    expect(out).toMatch(/ \/tmp\/out\.log /);
    expect(out).toMatch(/ `pnpm build`/);
    expect(out).not.toMatch(/\S\/tmp/);
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

describe('redactSecrets', () => {
  it('redacts a Bearer token, keeping the "Bearer" prefix', () => {
    const out = redactSecrets(
      'curl -H "Authorization: Bearer abcdef123456.xyz789" https://api.example.com',
    );
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('abcdef123456');
  });

  it('redacts an OpenAI-style key', () => {
    const out = redactSecrets('OPENAI_API_KEY=sk-abcdEFGH12345678ijklMNOP');
    expect(out).not.toContain('sk-abcdEFGH12345678ijklMNOP');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts an AWS access key id', () => {
    const out = redactSecrets('aws_access_key_id = AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts a GitHub token', () => {
    const out = redactSecrets('token: ghp_1234567890abcdefghijKLMNOPQRST');
    expect(out).not.toContain('ghp_1234567890abcdefghijKLMNOPQRST');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts generic key=value assignments and keeps the key name', () => {
    expect(redactSecrets('API_KEY=hunter22longvalue')).toBe('API_KEY=[REDACTED]');
    expect(redactSecrets('password: "hunter22222"')).toBe('password: "[REDACTED]"');
    expect(redactSecrets("secret = 'sup3rSecretValue'")).toBe("secret = '[REDACTED]'");
  });

  it('redacts prefixed env-var key names', () => {
    expect(redactSecrets('STRIPE_SECRET_KEY=abcdefgh12345678')).toBe(
      'STRIPE_SECRET_KEY=[REDACTED]',
    );
    expect(redactSecrets('DATABASE_PASSWORD=hunter2hunter2')).toBe('DATABASE_PASSWORD=[REDACTED]');
    expect(redactSecrets('MY_API_KEY=abcd1234efgh5678')).toBe('MY_API_KEY=[REDACTED]');
    expect(redactSecrets('aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCY12')).toBe(
      'aws_secret_access_key = [REDACTED]',
    );
  });

  it('leaves camelCase identifiers that merely contain secret words untouched', () => {
    const a = 'mySecretName = "abcd1234efgh"';
    expect(redactSecrets(a)).toBe(a);
    const b = 'const cacheKey = deriveCacheKey();';
    expect(redactSecrets(b)).toBe(b);
  });

  it('redacts a PEM private key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX\n-----END RSA PRIVATE KEY-----';
    const out = redactSecrets(`before\n${pem}\nafter`);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX');
  });

  it('leaves ordinary prose untouched', () => {
    const src = 'The token expires after 30 days and the secret sauce is fully documented.';
    expect(redactSecrets(src)).toBe(src);
  });

  it('leaves a sha hash embedded in a URL untouched', () => {
    const src = 'See https://github.com/acme/repo/commit/1234567890abcdef1234567890abcdef12345678';
    expect(redactSecrets(src)).toBe(src);
  });

  it('leaves code identifiers and function calls untouched', () => {
    const src = 'const apiKey = generateToken(); const secretValue = computeSecret();';
    expect(redactSecrets(src)).toBe(src);
  });

  it('leaves a plain-word value untouched (low confidence it is a secret)', () => {
    const src = 'password: forgotten';
    expect(redactSecrets(src)).toBe(src);
  });
});
