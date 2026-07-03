---
'@cavemem/installers': patch
'cavemem': patch
---

Surface which IDEs actually capture memory vs are query-only (#58)

Users installing cavemem into Cursor, Gemini CLI, Antigravity, or IBM Bob had no way
to tell — short of an empty database — that those integrations are MCP query-only:
hooks never fire, so no new observations are ever captured there. `cavemem status`
silently listed every installed IDE the same way.

Each `Installer` now declares `capture: 'full' | 'partial' | 'none'` (plus an optional
`captureNotes` caveat) reflecting what its `install()` actually wires up: Claude Code,
OpenCode, Codex CLI, GitHub Copilot, and Augment Code capture observations through
hooks (OpenCode via its bundled bridge plugin rather than a `hooks.json`-style file;
Codex and Copilot have no SessionEnd event; Augment has no UserPromptSubmit event).
Cursor, Gemini CLI, Antigravity, and IBM Bob register MCP only.

`cavemem status` reads this metadata and annotates query-only IDEs inline —
`ides: claude-code, antigravity (query-only)` — instead of listing them
indistinguishably from IDEs that actually fill the database. The README gains an IDE
capability matrix (capture / query / notes) under Install, with footnotes on
OpenCode's bridge plugin and the Copilot/Codex/Augment missing-event caveats.

No behavioral change to any installer's `install()`/`uninstall()` — this is metadata
and read-side reporting only.
