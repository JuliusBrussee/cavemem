---
'cavemem': minor
'@cavemem/installers': minor
'@cavemem/mcp-server': patch
---

Fix OpenCode integration: bridge plugin, correct config schema, and MCP server dynamic import

OpenCode support was previously broken in three ways:

1. **MCP server silently exited** when dynamically imported by `cavemem mcp`. The server chunk's `isMainEntry()` guard compared `import.meta.url` against `argv[1]`, which was still the CLI entrypoint. Fixed by exporting `main()` from `@cavemem/mcp-server` and calling it explicitly from the CLI `mcp` command.

2. **Wrong config path and schema** — the installer wrote `mcpServers` to `~/.opencode/config.json`, but OpenCode reads `mcp` from `~/.config/opencode/opencode.json`. The installer now writes the correct schema (`type: 'local'`, `command: [...]`, `enabled: true`).

3. **No hooks registered** — OpenCode has no native hooks system, so the cavemem database stayed empty. Added `apps/cli/src/opencode-bridge.ts`, an OpenCode plugin that maps opencode events to cavemem hooks (`session-start`, `session-end`, `user-prompt-submit`, `post-tool-use`, `stop`). The plugin also injects a system-prompt reminder about cavemem MCP tools and prior-session context retrieved via `@cavemem/core`.

The installer now:
- Writes the corrected MCP config to `~/.config/opencode/opencode.json`
- Symlinks `dist/opencode-bridge.js` into `~/.config/opencode/plugins/cavemem.js`
- Cleans up the legacy `~/.opencode/config.json` entry on install and uninstall
- Detects both the modern `~/.config/opencode/` and legacy `~/.opencode/` paths
