const SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/**
 * Convert a path-style glob to an anchored RegExp. No dependency pulled in for
 * this — the two operators cavemem's settings need are simple enough to hand-write:
 *   `**` — any number of path segments, including zero (so `**\/x` also matches bare `x`)
 *   `*`  — anything within a single segment (stops at `/`)
 * Every other character is matched literally.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++; // consume the second '*'
      if (pattern[i + 1] === '/') {
        re += '(?:.*/)?';
        i++; // consume the following '/' too — it's part of the "**/…" idiom
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += SPECIAL.has(c as string) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True if `value` matches any of `patterns` under glob semantics. */
export function matchesGlob(value: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(value));
}
