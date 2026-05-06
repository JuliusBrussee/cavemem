import { describe, expect, it } from 'vitest';

describe('MCP server module exports', () => {
  it('exports main() so the CLI can boot the stdio server', async () => {
    const mod = await import('../src/server.js');
    expect(typeof mod.main).toBe('function');
  });

  it('still exports buildServer for in-process inspector tests', async () => {
    const mod = await import('../src/server.js');
    expect(typeof mod.buildServer).toBe('function');
  });
});
