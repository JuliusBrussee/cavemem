---
'cavemem': minor
'@cavemem/installers': minor
---

Enhance OpenCode integration with full-featured bridge plugin

This changeset:

1. **Adds `apps/cli/src/opencode-bridge.ts`** — a bundled OpenCode plugin that maps
   opencode events to cavemem hooks (`session-start`, `session-end`,
   `user-prompt-submit`, `post-tool-use`, `stop`). It buffers streaming assistant
   text parts and flushes complete turn summaries, injects a system-prompt
   reminder about available cavemem MCP tools, and retrieves prior-session context
   from the 3 most recent ended sessions via `@cavemem/core`.

2. **Fixes the OpenCode installer** to:
   - Write the correct `mcp` schema (`type: 'local'`, `command: [...]`,
     `enabled: true`) to `~/.config/opencode/opencode.json`
   - Symlink the bundled `dist/opencode-bridge.js` into
     `~/.config/opencode/plugins/cavemem.js`
   - Register the plugin explicitly in the `plugin` array for clarity
   - Clean up the legacy `~/.opencode/config.json` entry on install and uninstall
   - Honor `XDG_CONFIG_HOME`

3. **Ships the bridge** — `apps/cli/tsup.config.ts` gains an `opencodeBridge`
   entry so `dist/opencodeBridge.js` is included in the published package.
