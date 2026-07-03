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

// Conservative, prefix-anchored token shapes only — no entropy guessing, so
// ordinary prose never trips it. Quantifiers are bounded to keep scans linear.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,64}\b/g, // OpenAI / Stripe style secret keys (sk-live-…, sk-proj-…)
  /\bghp_[A-Za-z0-9]{20,64}\b/g, // GitHub personal access token
  /\bgithub_pat_[A-Za-z0-9_]{20,128}\b/g, // GitHub fine-grained PAT
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,72}\b/g, // Slack token
];

/**
 * Replace common API-key shapes with [REDACTED]. Gated by
 * settings.privacy.redactSecrets at call sites.
 */
export function redactSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}
