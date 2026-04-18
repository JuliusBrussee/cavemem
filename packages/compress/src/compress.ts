import {
  abbreviationsFor,
  articlesFor,
  fillersFor,
  hedgesFor,
  pleasantriesFor,
} from './lexicon.js';
import { type Segment, tokenize } from './tokenize.js';
import type { Intensity } from './types.js';

export interface CompressOptions {
  intensity?: Intensity;
}

const _WORD_BOUNDARY = /\b/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removePhrases(text: string, phrases: string[]): string {
  if (phrases.length === 0) return text;
  // Sort longer phrases first so multi-word phrases match before single words.
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(?:${sorted.map(escapeRe).join('|')})\\b`, 'gi');
  return text.replace(pattern, '');
}

function abbreviate(text: string, map: Record<string, string>): string {
  let result = text;
  for (const [from, to] of Object.entries(map)) {
    const re = new RegExp(`\\b${escapeRe(from)}\\b`, 'gi');
    result = result.replace(re, (match) => matchCase(match, to));
  }
  return result;
}

function matchCase(source: string, target: string): string {
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return target[0]?.toUpperCase() + target.slice(1);
  return target;
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^ +| +$/gm, '');
}

function compressProse(text: string, intensity: Intensity): string {
  // Preserve a single boundary space/newline so the seam with adjacent
  // preserved tokens (paths, inline code, URLs) isn't eaten by
  // collapseWhitespace's per-line trim — "at /tmp/x" must not become
  // "at/tmp/x" when compressed.
  const leadingMatch = text.match(/^\s+/);
  const trailingMatch = text.match(/\s+$/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const trailing = trailingMatch ? trailingMatch[0] : '';
  const body = text.slice(leading.length, text.length - trailing.length);
  if (body.length === 0) return text;
  let out = body;
  out = removePhrases(out, pleasantriesFor(intensity));
  out = removePhrases(out, hedgesFor(intensity));
  out = removePhrases(out, fillersFor(intensity));
  out = removePhrases(out, articlesFor(intensity));
  out = abbreviate(out, abbreviationsFor(intensity));
  out = collapseWhitespace(out);
  const leftPad = leading.includes('\n') ? '\n' : leading ? ' ' : '';
  const rightPad = trailing.includes('\n') ? '\n' : trailing ? ' ' : '';
  return `${leftPad}${out}${rightPad}`;
}

/**
 * Compress prose segments while preserving code, URLs, paths, commands,
 * version numbers, dates, identifiers, numbers, and headings verbatim.
 */
export function compress(input: string, opts: CompressOptions = {}): string {
  const intensity: Intensity = opts.intensity ?? 'full';
  const segments: Segment[] = tokenize(input);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.preserved) {
      out.push(seg.text);
      continue;
    }
    out.push(compressProse(seg.text, intensity));
  }
  return out.join('').replace(/[ \t]+([.,;:!?])/g, '$1');
}
