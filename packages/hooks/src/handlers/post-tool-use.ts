import { matchesGlob } from '@cavemem/config';
import type { MemoryStore } from '@cavemem/core';
import type { HookInput } from '../types.js';

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];
// Whitespace/quote-delimited "word" scan used to catch paths embedded in
// free-form strings (e.g. a Bash `command` field), not just dedicated fields.
const PATH_LIKE_TOKEN_RE = /[^\s"'`]+/g;
// Bound the scan so a large tool payload (e.g. a big file Read) can't blow
// the hook's 150ms p95 budget when excludePatterns is configured.
const MAX_SCAN_LEN = 8000;

export async function postToolUse(store: MemoryStore, input: HookInput): Promise<void> {
  const tool = input.tool_name ?? input.tool ?? 'unknown';
  if (isToolExcluded(tool, store.settings.capture)) return;

  const toolInput = input.tool_input;
  const toolOutput = input.tool_response ?? input.tool_output;

  const excludePatterns = store.settings.privacy.excludePatterns;
  if (excludePatterns.length > 0 && isPathExcluded(toolInput, toolOutput, excludePatterns)) {
    // Rule: excluded content never appears in logs — skip silently, no trace.
    return;
  }

  const body =
    `${tool} input=${stringifyShort(toolInput)} output=${stringifyShort(toolOutput)}`.slice(
      0,
      4000,
    );
  if (!body.trim()) return;
  store.addObservation({
    session_id: input.session_id,
    kind: 'tool_use',
    content: body,
    metadata: { tool },
  });
}

function isToolExcluded(
  tool: string,
  capture: { excludeTools: string[]; includeTools: string[] },
): boolean {
  if (capture.excludeTools.length > 0 && matchesGlob(tool, capture.excludeTools)) return true;
  if (capture.includeTools.length > 0 && !matchesGlob(tool, capture.includeTools)) return true;
  return false;
}

/**
 * True if any path-bearing field or path-like token in the tool's input/output
 * matches an excludePatterns glob. Checked against dedicated path keys
 * (file_path, path, notebook_path) plus a whitespace-token scan of the raw
 * input/output so paths embedded in strings (e.g. a shell command) are caught.
 */
function isPathExcluded(toolInput: unknown, toolOutput: unknown, patterns: string[]): boolean {
  for (const candidate of candidatePaths(toolInput, toolOutput)) {
    if (matchesGlob(candidate, patterns)) return true;
  }
  return false;
}

function candidatePaths(toolInput: unknown, toolOutput: unknown): string[] {
  const out: string[] = [];
  collectPathFields(toolInput, out);
  collectPathFields(toolOutput, out);
  for (const raw of [toolInput, toolOutput]) {
    const text = typeof raw === 'string' ? raw : safeStringify(raw);
    if (!text) continue;
    for (const m of text.slice(0, MAX_SCAN_LEN).matchAll(PATH_LIKE_TOKEN_RE)) out.push(m[0]);
  }
  return out;
}

function collectPathFields(value: unknown, out: string[]): void {
  if (!value || typeof value !== 'object') return;
  for (const key of PATH_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === 'string') out.push(v);
  }
}

function safeStringify(v: unknown): string {
  if (v == null) return '';
  try {
    // Cap giant leaf strings during serialization — a multi-MB file payload
    // should not pay full stringify cost only to be sliced afterwards.
    return JSON.stringify(v, (_key, val) =>
      typeof val === 'string' && val.length > MAX_SCAN_LEN ? val.slice(0, MAX_SCAN_LEN) : val,
    );
  } catch {
    return '';
  }
}

function stringifyShort(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return String(v);
  }
}
