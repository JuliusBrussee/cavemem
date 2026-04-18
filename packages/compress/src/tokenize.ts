export type SegmentKind =
  | 'fence'
  | 'inline-code'
  | 'url'
  | 'path'
  | 'command'
  | 'version'
  | 'date'
  | 'number'
  | 'identifier'
  | 'heading'
  | 'prose'
  | 'newline';

export interface Segment {
  kind: SegmentKind;
  text: string;
  preserved: boolean;
}

interface RulePattern {
  kind: SegmentKind;
  priority: number;
  re: RegExp;
}

// Priority (higher wins on overlap): fence > inline-code > url > heading >
// path > date > version > number > identifier. Headings are line-scoped.
const RULES: RulePattern[] = [
  { kind: 'fence', priority: 100, re: /```[\s\S]*?```|~~~[\s\S]*?~~~/g },
  { kind: 'inline-code', priority: 90, re: /`[^`\n]+`/g },
  { kind: 'url', priority: 80, re: /\bhttps?:\/\/[^\s)\]]+/g },
  { kind: 'heading', priority: 70, re: /^#{1,6}\s[^\n]*$/gm },
  {
    kind: 'path',
    priority: 60,
    re: /(?:(?:\.{1,2})?\/[A-Za-z0-9._\-/]+|~\/[A-Za-z0-9._\-/]+|[A-Z]:\\[A-Za-z0-9._\-\\]+)/g,
  },
  { kind: 'date', priority: 50, re: /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?\b/g },
  { kind: 'version', priority: 40, re: /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/g },
  { kind: 'number', priority: 30, re: /\b\d+(?:\.\d+)?\b/g },
  {
    kind: 'identifier',
    priority: 20,
    re: /\b[A-Za-z_][A-Za-z0-9_]*[-_][A-Za-z0-9_\-]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g,
  },
];

interface Span {
  start: number;
  end: number;
  kind: SegmentKind;
  priority: number;
}

/**
 * Single-pass tokenizer. Collects all rule matches across the input, resolves
 * overlaps by priority (with earlier-start as tie-breaker, then wider span),
 * and emits a non-overlapping list of preserved + prose segments.
 */
export function tokenize(input: string): Segment[] {
  const spans: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m = rule.re.exec(input);
    while (m !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
      } else {
        spans.push({
          start: m.index,
          end: m.index + m[0].length,
          kind: rule.kind,
          priority: rule.priority,
        });
      }
      m = rule.re.exec(input);
    }
  }
  // Resolve overlaps greedily.
  spans.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.end - a.end; // wider first
  });
  const resolved: Span[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue; // overlaps a higher-priority/earlier span
    // Check if a later, higher-priority span starts inside this one.
    // Because we sorted by start ASC and priority DESC at same start, the
    // first span starting at any index is the winner. That's sufficient.
    resolved.push(s);
    cursor = s.end;
  }
  resolved.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let pos = 0;
  for (const s of resolved) {
    if (s.start > pos) {
      out.push({ kind: 'prose', text: input.slice(pos, s.start), preserved: false });
    }
    out.push({ kind: s.kind, text: input.slice(s.start, s.end), preserved: true });
    pos = s.end;
  }
  if (pos < input.length) {
    out.push({ kind: 'prose', text: input.slice(pos), preserved: false });
  }
  return out;
}

export function detokenize(segments: Segment[]): string {
  return segments.map((s) => s.text).join('');
}
