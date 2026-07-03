const PRIVATE_RE = /<private>[\s\S]*?<\/private>/gi;

/**
 * Strip anything wrapped in <private>…</private>. Applied before compression
 * and before any I/O to storage or logs. Unmatched opening tags are dropped
 * to the end of input to be safe.
 */
export function redactPrivate(input: string): string {
  const closed = input.replace(PRIVATE_RE, '');
  // Safety: if an unclosed <private> remains, redact from it to end-of-input.
  const idx = closed.search(/<private>/i);
  if (idx >= 0) return closed.slice(0, idx);
  return closed;
}

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{16,}/g;
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g;
const GITHUB_TOKEN_RE = /\bgh[pousr]_[A-Za-z0-9]{20,}/g;
const GITHUB_FINE_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,128}\b/g;
const SLACK_TOKEN_RE = /\bxox[baprs]-[A-Za-z0-9-]{10,72}\b/g;
// `key = value` / `key: value` assignments whose key name ends in a
// recognised secret word. The optional [\w-]* prefix catches env-var style
// names (STRIPE_SECRET_KEY, DATABASE_PASSWORD, aws_secret_access_key) —
// a plain \b never fires between word chars, so an anchored alternation
// alone misses them. Bare `key` requires a preceding `_`/`-` so camelCase
// identifiers like `cacheKey` never match. The value alternates quoted (") /
// quoted (') / bare so the closing quote is never swallowed by \S{8,}.
const ASSIGNMENT_RE =
  /\b([\w-]*(?:api[_-]?key|secret|token|password|passwd|authorization|[_-]key))(\s*[=:]\s*)(?:"([^"\s]{8,})"|'([^'\s]{8,})'|(\S{8,}))/gi;

/**
 * True if `value` is secret-shaped enough to redact: long enough, and not
 * merely a code identifier (function call) or a plain dictionary word.
 * Keeps false positives on ordinary source code / prose low.
 */
function looksSecretish(value: string): boolean {
  if (value.length < 8) return false;
  if (/^[A-Za-z_$][\w$]*\(.*\)?;?$/.test(value)) return false;
  if (/^[A-Za-z]+$/.test(value)) return false;
  return true;
}

/**
 * Scrub secret-shaped substrings — bearer tokens, provider API keys, AWS/GitHub
 * credentials, generic key=value assignments, and PEM private key blocks —
 * before compression. Gated by settings.privacy.redactSecrets, independent of
 * (and applied alongside) redactPrivate.
 */
export function redactSecrets(text: string): string {
  let out = text.replace(PEM_RE, '[REDACTED]');
  out = out.replace(BEARER_RE, 'Bearer [REDACTED]');
  out = out.replace(OPENAI_KEY_RE, '[REDACTED]');
  out = out.replace(AWS_KEY_RE, '[REDACTED]');
  out = out.replace(GITHUB_TOKEN_RE, '[REDACTED]');
  out = out.replace(GITHUB_FINE_PAT_RE, '[REDACTED]');
  out = out.replace(SLACK_TOKEN_RE, '[REDACTED]');
  out = out.replace(ASSIGNMENT_RE, (match, key, sep, dq, sq, bare) => {
    const value: string = dq ?? sq ?? bare;
    if (!looksSecretish(value)) return match;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '';
    return `${key}${sep}${quote}[REDACTED]${quote}`;
  });
  return out;
}
