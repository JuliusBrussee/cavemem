import { expansions } from './lexicon.js';
import { tokenize } from './tokenize.js';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCase(source: string, target: string): string {
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return target[0]?.toUpperCase() + target.slice(1);
  return target;
}

/**
 * Expand abbreviations back to their long form. Does not restore dropped
 * filler words — compression of those is lossy by design. Technical tokens
 * are preserved byte-for-byte because they are held out of the expansion
 * pass by the tokenizer.
 */
export function expand(input: string): string {
  const segments = tokenize(input);
  const map = expansions();
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return input;
  const pattern = new RegExp(`\\b(?:${keys.map(escapeRe).join('|')})\\b`, 'gi');

  return segments
    .map((seg) => {
      if (seg.preserved) return seg.text;
      return seg.text.replace(pattern, (match) => {
        const key = match.toLowerCase();
        const target = map[key];
        return target ? matchCase(match, target) : match;
      });
    })
    .join('');
}
