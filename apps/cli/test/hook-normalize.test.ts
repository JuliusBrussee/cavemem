import { describe, expect, it } from 'vitest';
import { normalizeForIde } from '../src/commands/hook.js';

describe('normalizeForIde', () => {
  it('maps a full Augment payload: conversation_id, workspace_roots[0], agentTextResponse', () => {
    const out = normalizeForIde('augment', {
      hook_event_name: 'Stop',
      conversation_id: 'conv-1',
      workspace_roots: ['/proj/a', '/proj/b'],
      conversation: { userPrompt: 'fix bug', agentTextResponse: 'fixed the bug' },
    });
    expect(out.session_id).toBe('conv-1');
    expect(out.cwd).toBe('/proj/a');
    expect(out.turn_summary).toBe('fixed the bug');
  });

  it('leaves cwd unset on an empty workspace_roots array', () => {
    const out = normalizeForIde('augment', { conversation_id: 'c', workspace_roots: [] });
    expect(out.session_id).toBe('c');
    expect(out.cwd).toBeUndefined();
  });

  it('leaves turn_summary unset when conversation is missing on Stop', () => {
    const out = normalizeForIde('augment', {
      hook_event_name: 'Stop',
      conversation_id: 'c',
      agent_stop_cause: 'end_turn',
    });
    expect(out.turn_summary).toBeUndefined();
  });

  it('passes non-augment payloads through untouched', () => {
    const payload = { conversation_id: 'x', workspace_roots: ['/a'] };
    expect(normalizeForIde('claude-code', payload)).toBe(payload);
    expect(normalizeForIde(undefined, payload)).toBe(payload);
  });

  it('does not overwrite explicitly provided session_id, cwd, or turn_summary', () => {
    const out = normalizeForIde('augment', {
      session_id: 'explicit-session',
      cwd: '/explicit',
      turn_summary: 'explicit summary',
      conversation_id: 'other',
      workspace_roots: ['/other'],
      conversation: { agentTextResponse: 'other text' },
    });
    expect(out.session_id).toBe('explicit-session');
    expect(out.cwd).toBe('/explicit');
    expect(out.turn_summary).toBe('explicit summary');
  });
});
