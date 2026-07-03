# @cavemem/installers

## 0.3.0

### Minor Changes

- 7b7662d: Add four new IDE installers (#23, #8, #38, #10)

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

- 73c52c3: Enhance OpenCode integration with full-featured bridge plugin

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

- f2e2f49: Issue sweep: fix six bugs across config, installers, and embedding.

  - **config (#25):** Correct the inverted description for `search.alpha`. The
    ranker computes `alpha * bm25 + (1 - alpha) * cosine`, so `1 = pure BM25`
    and `0 = pure cosine`. Doc-only — no behavior change.
  - **installers/claude-code (#19):** Write the cavemem MCP server entry to
    `~/.claude.json` instead of `~/.claude/settings.json`. Newer Claude Code
    reads MCP config from `~/.claude.json`; the previous location was silently
    ignored. Hooks continue to live in `~/.claude/settings.json`. Legacy
    `mcpServers.cavemem` entries in `settings.json` are migrated out on
    install.
  - **installers/claude-code (#12):** Stop overwriting pre-existing entries in
    `hooks.SessionStart` / `PostToolUse` / etc. The installer now appends
    cavemem's hook to whatever is already there and writes a one-shot
    `settings.json.pre-cavemem-<unix-ts>` backup before mutating a file with
    prior hooks. Re-running install no longer duplicates cavemem entries.
  - **installers/codex (#17):** Switch from `~/.codex/config.json` (which
    Codex never read) to `~/.codex/config.toml` with the `[features]
codex_hooks = true` flag and an `[mcp_servers.cavemem]` table. Also write
    `~/.codex/hooks.json` with `SessionStart` / `UserPromptSubmit` /
    `PostToolUse` / `Stop` entries so observations are actually captured.
    Adds `smol-toml` as a dependency (bundled into the CLI dist).
  - **installers/opencode (#14):** Drop a generated plugin at
    `~/.config/opencode/plugins/cavemem.js` that hooks into
    `session.created` / `session.idle` / `tool.execute.before` /
    `tool.execute.after` and forwards to `cavemem hook run …`. Previously the
    installer only registered an MCP server and no hooks fired at all, so
    observations were empty. Plugin is registered in `opencode.json` and
    uses detached `child_process.spawn` so the IDE never blocks on a hook.
    Path migrated to OpenCode's documented global config location
    (`~/.config/opencode/`, honoring `XDG_CONFIG_HOME`).
  - **embedding (#20):** Detect musl libc (Alpine, musl-built Node) before
    importing `@xenova/transformers`. The bundled `onnxruntime-node` prebuilts
    target glibc and have segfaulted on Alpine in the wild; we now throw a
    clean error pointing at `embedding.provider: 'none' | 'ollama'`.

### Patch Changes

- d2d022e: Surface which IDEs actually capture memory vs are query-only (#58)

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

- bf71913: fix(installers): quote Windows paths in hook commands even without spaces (#41)

  `shellQuote` previously treated `\` as a bare-token character, so a default
  Windows install path with no spaces was written unquoted into the hook
  `command` string in `~/.claude/settings.json`. When Claude Code on Windows
  runs the hook through MSYS-bash, unquoted backslashes are treated as escape
  introducers and stripped, mangling the path
  `C:\Users\...\node_modules\cavemem\dist\index.js` into
  `CUsers...node_modulescavememdistindex.js` and the hook fails with
  `MODULE_NOT_FOUND`. After this fix, any path containing a backslash gets
  wrapped in double quotes; both cmd.exe and MSYS-bash preserve the
  backslashes verbatim inside `"..."`. POSIX paths are unaffected.

- 69965ea: fix(cli,installers): warn loudly when `sh` is missing on Windows (#56, #57)

  Claude Code wraps hook `command` strings in `sh -c` even on Windows. If Git
  for Windows' `Git\bin` isn't on the user's `Path`, `sh` doesn't resolve,
  every hook fails non-blocking, and cavemem silently stops capturing memory —
  `cavemem doctor` and `cavemem status` kept reporting healthy because the
  failure never reached the CLI (#56).

  `checkWindowsSh()` (new, `@cavemem/installers`) checks `sh` resolvability on
  win32 with an injectable resolver for testing; it's a no-op on every other
  platform. `cavemem doctor` now runs it and exits non-zero with a loud
  warning + the one-time fix (`C:\Program Files\Git\bin`, or the Scoop
  `usr\bin` equivalent, onto user `Path`; verify with `where.exe sh`).
  `cavemem install --ide claude-code` runs the same check and prints the same
  warning, but does not refuse to install — the user may fix `Path` afterward
  and hooks will start working without a re-install.

  **#57 (pwsh emission):** investigated switching the emitted hook `command`
  to Claude Code's newer `shell` field (`"bash"` / `"powershell"`) or its
  shell-free `args` exec form. Held off: we can't verify either against every
  installed Claude Code version, and the current command has no shell
  metacharacters, so it already tokenizes identically whether Claude Code
  runs it through `sh` or falls back to PowerShell. The #56 fix above — make
  the missing-`sh` failure loud instead of silent — is the actionable part we
  could ship with confidence. See the Windows note in the README and the
  comment in `packages/installers/src/claude-code.ts` for the full reasoning.

- Updated dependencies [dec94ef]
- Updated dependencies [51e3608]
- Updated dependencies [b5976a5]
- Updated dependencies [6dc2ae5]
- Updated dependencies [f2e2f49]
  - @cavemem/config@0.3.0

## 0.2.0

### Patch Changes

- 99ca440: Fix the Claude Code hook integration end-to-end and harden the npm publish path. With these changes the memory system actually works after `npm install -g cavemem` — verified by the new `scripts/e2e-publish.sh` test that packs the artifact, installs it into an isolated prefix, and drives every hook event with realistic Claude Code payloads.

  **Hook protocol**

  - Handlers now read the field names Claude Code actually sends — `tool_name`, `tool_response`, `last_assistant_message`, `source`, `reason` — while keeping the legacy aliases (`tool`, `tool_output`, `turn_summary`) for non-Claude IDEs and existing tests.
  - The CLI no longer dumps internal telemetry JSON onto stdout. That JSON was being injected verbatim into the agent's context as `additionalContext` for `SessionStart` / `UserPromptSubmit`. Telemetry now goes to stderr; stdout carries Claude Code's `{ "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }` shape only when there is real context to surface.
  - `Storage.createSession` is now `INSERT OR IGNORE`, and `SessionStart` skips the prior-session preface for non-startup sources, so resume / clear / compact no longer crash with PK conflicts.
  - The Claude Code installer writes `cavemem hook run <name> --ide claude-code`, and the CLI's `hook run` accepts `--ide` so handlers know who invoked them (Claude Code itself never sends an `ide` field).

  **Publishable artifact**

  - `cavemem` no longer lists the private `@cavemem/mcp-server` and `@cavemem/worker` packages as runtime dependencies. Tsup already bundles every `@cavemem/*` module via `noExternal`, so the workspace deps moved to `devDependencies` and `npm install cavemem` resolves cleanly.
  - The bin entrypoint guard (`isMainEntry()`) now compares realpaths via `pathToFileURL(realpathSync(...))`, so the binary works when invoked through npm's symlinked `bin/` shim — previously `--version` and every other command silently exited 0 with no output.
  - Tsup's `banner` option was producing two `#!/usr/bin/env node` lines in every dynamic-import chunk (one from the source file, one from the banner), which broke `cavemem mcp` with `SyntaxError: Invalid or unexpected token`. The banner is gone; the shebang lives in the source files that need it.
  - A new `prepublishOnly` script (`apps/cli/scripts/prepack.mjs`) stages `README.md`, `LICENSE`, and `hooks-scripts/` into `apps/cli/` so `changeset publish` produces a complete tarball. The script no-ops outside the source repo so installing the tarball never re-runs it.
  - The root workspace package was renamed from `cavemem` to `cavemem-monorepo` (still `private:true`) to remove a name collision that caused `pnpm --filter cavemem` to match the root instead of the publishable cli package.

  **CI**

  - The release workflow now runs all four gates (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`) and the new `bash scripts/e2e-publish.sh` end-to-end check before `changeset publish` is allowed to publish.

- 7278a69: Fix `spawn EFTYPE` on Windows and unblock installs on Windows end-to-end.

  **Root cause**

  The CLI's `process.argv[1]` (and everything `resolveCliPath()` derives from it) is the `.js` entry file, not a native executable. Node's `child_process.spawn` cannot exec a raw `.js` on Windows — it has no associated binfmt handler, so the launcher bubbles up `EFTYPE`. Every background code path that self-spawned the CLI — `cavemem start`, `cavemem restart`, `cavemem viewer`, and the hook auto-spawn in `@cavemem/hooks` — hit this, so the worker never started and hooks stayed degraded with no embeddings. The installers then wrote the same bad shape into IDE configs (`command: <cliPath.js>` for MCP servers; `"<cliPath.js> hook run …"` as a shell string for Claude Code hooks), so even opening Claude Code / Cursor / Codex / Gemini / OpenCode could not launch the CLI.

  **Fix**

  - Every internal `spawn(cli, [...])` now spawns `process.execPath` with the CLI path as the first arg — cross-platform and does not rely on the OS knowing how to exec a `.js`.
  - `InstallContext` gains a required `nodeBin` field (populated with `process.execPath`). All five installers write `command: nodeBin, args: [cliPath, "mcp", ...]` instead of `command: cliPath, args: ["mcp"]`.
  - The Claude Code installer's hook command strings are now `"<nodeBin>" "<cliPath>" hook run <name> --ide claude-code`, with paths wrapped via a new `shellQuote` helper so `C:\Program Files\nodejs\node.exe` and `C:\Users\Some User\...\index.js` survive both cmd.exe and sh without splitting.
  - Added a Windows-path regression test in `packages/installers/test/installers.test.ts` so the quoting stays correct.

  **Upgrade note**

  Existing Windows installs still have the broken shape written into `~/.claude/settings.json`, `~/.cursor/mcp.json`, etc. After upgrading, run `cavemem install` (and `cavemem install --ide cursor`, etc.) once to rewrite those files with the corrected `nodeBin + cliPath` form. Nothing else changes for macOS and Linux users.

- 4af0d0d: Build, lint, and test-ecosystem fixes:

  - Drop `incremental: true` from the base tsconfig so `tsup --dts` stops failing with TS5074 and `pnpm build` is green again.
  - Resolve the full Biome lint backlog (organizeImports, useImportType) across every package. `pnpm lint` is now clean.
  - Fix a compression bug where `collapseWhitespace` would eat the single space between prose and preserved tokens (paths, inline code, URLs), producing unreadable output like `at/tmp/foo.txt`. Boundary spacing is now preserved on compress and round-tripped through expand.
  - Fix `Storage.timeline(sessionId, aroundId, limit)` — the previous single-UNION query let the "after" half swallow the whole window. Replaced with two bounded queries merged in JS so both halves are respected.
  - Remove a double `expand()` call in the MCP `get_observations` tool; expansion now happens exactly once inside `MemoryStore`.
  - `runHook()` now accepts an injected `MemoryStore` so tests (and other integrations) can avoid touching the user's real `~/.cavemem` data directory.

  Test ecosystem: brand-new suites for `@cavemem/hooks` (runner + all 5 handlers + hot-path budget check), `@cavemem/installers` (claude-code idempotency, settings preservation, cursor install/uninstall, registry, deepMerge), `@cavemem/mcp-server` (InMemory MCP client hitting every tool and asserting the progressive-disclosure shape), `@cavemem/worker` (Hono `app.request()` integration tests for every HTTP route), and the `cavemem` CLI (command registration smoke test). Total tests: 22 → 54.

  None of the new test directories are shipped — every published package keeps its `files` allowlist pointed at `dist` only.

- Updated dependencies [416957b]
  - @cavemem/config@0.2.0
