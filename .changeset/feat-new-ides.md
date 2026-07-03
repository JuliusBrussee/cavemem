---
'cavemem': minor
'@cavemem/installers': minor
---

Add four new IDE installers (#23, #8, #38, #10)

- **GitHub Copilot / VS Code** (`--ide copilot`, #23) — full capture+query. Hooks are
  written to a cavemem-owned `~/.copilot/hooks/cavemem.json` (Copilot's payloads are
  Claude-Code-compatible, so existing handlers read them without translation; Copilot
  has no SessionEnd event). MCP is registered in VS Code's user-level `mcp.json`
  (platform-dependent path, root key `servers`, explicit `type: "stdio"`).
- **Augment Code** (`--ide augment`, #8) — full capture+query via `~/.augment/settings.json`.
  Augment's hook `command` must be a script-file path, so the installer writes thin
  wrapper scripts (`.sh`, or `.cmd` on Windows) into `~/.augment/cavemem-hooks/` that
  exec the CLI. Augment has no UserPromptSubmit event; the Stop hook sets
  `metadata.includeConversationData` because without it the payload carries no
  assistant text and turn-summary capture would silently store nothing. The CLI's
  `hook run` gains an Augment payload shim mapping `conversation_id` → `session_id`,
  `workspace_roots[0]` → `cwd`, and `conversation.agentTextResponse` → `turn_summary`.
- **Antigravity** (`--ide antigravity`, #38) — query-only (no hooks system). Registers
  MCP in `~/.gemini/config/mcp_config.json` and warns that sessions there capture no
  new observations.
- **IBM Bob** (`--ide bob`, #10) — query-only. Registers MCP in `~/.bob/mcp.json` with
  the same warning.

All four merge non-destructively into existing configs, are idempotent on re-install,
and remove only cavemem-owned entries (plus Augment's wrapper-script dir) on uninstall.
