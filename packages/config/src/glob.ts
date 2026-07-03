/**
 * Path-style glob matching. Two operators, hand-rolled — no dependency:
 *   `**` (as a whole segment) — any number of path segments, including zero,
 *        so a leading `**` + `/x` also matches a bare `x`
 *   `*`  — anything within a single segment (never crosses `/`)
 * Everything else matches literally. Matching walks segments with an
 * iterative two-pointer scan instead of a concatenated RegExp — repeated
 * globstars must stay linear, where the regex encoding backtracks
 * combinatorially on long slash-dense inputs. Backslashes normalize to `/`
 * on both sides: Windows tool payloads carry native `C:\...` paths while
 * settings globs are written with `/`.
 */

const patternCache = new Map<string, string[]>();

function patternSegments(pattern: string): string[] {
  let segs = patternCache.get(pattern);
  if (segs) return segs;
  const raw = pattern.replace(/\\/g, '/').split('/');
  segs = raw
    // Adjacent `**` segments are equivalent to one; collapsing keeps the walk short.
    .filter((s, i) => s !== '**' || raw[i - 1] !== '**')
    // `**` embedded in a segment (e.g. `**.log`) behaves like `*`.
    .map((s) => (s === '**' ? s : s.replace(/\*{2,}/g, '*')));
  patternCache.set(pattern, segs);
  return segs;
}

/** Match one path segment against a pattern segment where `*` is a wildcard. */
function segmentMatch(text: string, pat: string): boolean {
  let ti = 0;
  let pi = 0;
  let starPi = -1;
  let starTi = 0;
  while (ti < text.length) {
    if (pat[pi] === '*') {
      starPi = pi;
      starTi = ti;
      pi++;
    } else if (pat[pi] === text[ti]) {
      pi++;
      ti++;
    } else if (starPi >= 0) {
      starTi++;
      ti = starTi;
      pi = starPi + 1;
    } else {
      return false;
    }
  }
  while (pat[pi] === '*') pi++;
  return pi === pat.length;
}

/** Segment-level walk: `**` plays the role `*` plays at character level. */
function matchSegments(vsegs: string[], psegs: string[]): boolean {
  let vi = 0;
  let pi = 0;
  let starPi = -1;
  let starVi = 0;
  while (vi < vsegs.length) {
    const p = psegs[pi];
    if (p === '**') {
      starPi = pi;
      starVi = vi;
      pi++;
    } else if (p !== undefined && segmentMatch(vsegs[vi] ?? '', p)) {
      pi++;
      vi++;
    } else if (starPi >= 0) {
      starVi++;
      vi = starVi;
      pi = starPi + 1;
    } else {
      return false;
    }
  }
  while (psegs[pi] === '**') pi++;
  return pi === psegs.length;
}

/** True if `value` matches any of `patterns` under glob semantics. */
export function matchesGlob(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const vsegs = value.replace(/\\/g, '/').split('/');
  return patterns.some((p) => matchSegments(vsegs, patternSegments(p)));
}
