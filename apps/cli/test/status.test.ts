import { describe, expect, it } from 'vitest';
import { annotateIde } from '../src/commands/status.js';

// #58: `cavemem status` must flag IDEs that are query-only (MCP works, but
// no hooks ever fire — the DB never fills) so users don't mistake silence
// for a bug. See packages/installers capture metadata for the source of truth.
describe('annotateIde', () => {
  it('leaves capturing IDEs unannotated', () => {
    expect(annotateIde('claude-code')).toBe('claude-code');
    expect(annotateIde('opencode')).toBe('opencode');
    expect(annotateIde('codex')).toBe('codex');
    expect(annotateIde('copilot')).toBe('copilot');
    expect(annotateIde('augment')).toBe('augment');
  });

  it('flags query-only IDEs', () => {
    expect(annotateIde('antigravity')).toBe('antigravity (query-only)');
    expect(annotateIde('bob')).toBe('bob (query-only)');
    expect(annotateIde('cursor')).toBe('cursor (query-only)');
    expect(annotateIde('gemini-cli')).toBe('gemini-cli (query-only)');
  });

  it('passes through an unknown IDE name unchanged', () => {
    expect(annotateIde('not-a-real-ide')).toBe('not-a-real-ide');
  });
});
