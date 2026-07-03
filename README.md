<div align="center">

![](https://em-content.zobj.net/source/apple/391/rock_1faa8.png)

# cavemem

**why agent forget when agent can remember**

[![npm](https://img.shields.io/npm/v/cavemem?style=flat&color=yellow)](https://www.npmjs.com/package/cavemem) [![Stars](https://img.shields.io/github/stars/JuliusBrussee/cavemem?style=flat&color=yellow)](https://github.com/JuliusBrussee/cavemem/stargazers) [![Last Commit](https://img.shields.io/github/last-commit/JuliusBrussee/cavemem?style=flat)](https://github.com/JuliusBrussee/cavemem/commits/main) [![License](https://img.shields.io/github/license/JuliusBrussee/cavemem?style=flat)](LICENSE)

[Install](#install) • [How it works](#how-it-works) • [CLI](#cli) • [MCP](#mcp) • [Settings](#settings)

</div>

<p align="center">
  <strong>🪨 Caveman Ecosystem</strong> &nbsp;·&nbsp;
  <a href="https://github.com/JuliusBrussee/caveman">caveman</a> <em>talk less</em> &nbsp;·&nbsp;
  <strong>cavemem</strong> <em>remember more</em> <sub>(you are here)</sub> &nbsp;·&nbsp;
  <a href="https://github.com/JuliusBrussee/cavekit">cavekit</a> <em>build better</em> &nbsp;·&nbsp;
  <a href="https://github.com/JuliusBrussee/finetune-caveman">cavegemma</a> <em>weights remember</em>
</p>


---

Cross-agent persistent memory for coding assistants. Hooks fire at session boundaries, compress observations with the caveman grammar (~75% fewer prose tokens, code and paths preserved byte-for-byte), and write to local SQLite. Agents query their own history through three MCP tools. No network. No cloud.

**Supports:** Claude Code · OpenCode · Codex · GitHub Copilot · Augment Code · Cursor (query-only) · Gemini CLI (query-only) · Antigravity (query-only) · IBM Bob (query-only)

- **Persistent memory across sessions.** Hooks capture what happened; the store keeps it.
- **Compressed at rest.** Deterministic caveman grammar, round-trip-guaranteed expansion for humans.
- **Progressive MCP retrieval.** `search`, `timeline`, `get_observations` — agents filter before fetching.
- **Hybrid search.** SQLite FTS5 keyword + local vector index, combined with a tunable ranker.
- **Local by default.** No network calls. Optional remote embedding providers via config.
- **Web viewer.** Read-only UI at `http://localhost:37777` for browsing sessions in human-readable form. Token-protected: the worker generates a local bearer token on first start and injects it into the served page, so `cavemem viewer` still opens with zero friction while `/api/*` rejects requests without it.
- **Cross-IDE installers.** Claude Code, OpenCode, Codex, GitHub Copilot, Augment Code capture observations; Cursor, Gemini CLI, Antigravity, IBM Bob are query-only (MCP search over memory captured elsewhere) — one command each, see the [capability matrix](#install).
- **Privacy-aware.** `<private>...</private>` stripped at write boundary. Path globs exclude whole directories.

---

## Install

```sh
npm install -g cavemem
cavemem install                    # Claude Code
cavemem install --ide cursor       # cursor | gemini-cli | opencode | codex | copilot | augment | antigravity | bob
cavemem status                     # see wiring + embedding backfill
cavemem viewer                     # open http://127.0.0.1:37777
```

No daemon to start. Hooks write synchronously. A local worker auto-spawns in the background on the first hook to build embeddings and serve the viewer; it self-exits when idle (set `embedding.idleShutdownMs` to `0` to keep it running until killed). Disable auto-spawn — and with it the HTTP listener — with `cavemem config set embedding.autoStart false`.

### IDE capability matrix

"Query" means the MCP server can search memory captured elsewhere. "Capture" means this IDE's own sessions write new observations — without it, the DB never fills for that IDE no matter how healthy `cavemem status` otherwise looks (#58).

| IDE | capture (hooks) | query (MCP) | notes |
|-----|:---:|:---:|-------|
| Claude Code | ✓ | ✓ | 5 hooks: SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd |
| OpenCode | ✓ | ✓ | via bundled bridge plugin¹ |
| Codex CLI | ✓ | ✓ | no SessionEnd event² |
| GitHub Copilot | ✓ | ✓ | no SessionEnd event² |
| Augment Code | ✓ | ✓ | no UserPromptSubmit event² |
| Cursor | — | ✓ | query-only — no hooks system |
| Gemini CLI | — | ✓ | query-only — no hooks system |
| Antigravity | — | ✓ | query-only — no hooks system |
| IBM Bob | — | ✓ | query-only — no hooks system |

¹ OpenCode has no `hooks.json`-style event system. Capture instead goes through a bundled bridge plugin (`opencodeBridge.js`, symlinked into OpenCode's plugin dir on install) that subscribes to OpenCode's native `event` and `tool.execute.after` hooks and shells out to the same `cavemem hook run` handlers every other IDE uses — same lifecycle coverage, different wiring.

² Copilot's and Codex's hook payloads are close enough to Claude Code's shape that the same handlers are reused unmodified, but neither event set is complete: Codex and Copilot have no `SessionEnd`, and Augment has no `UserPromptSubmit`. Every other lifecycle moment still fires and gets written.

Run `cavemem status` after installing to see which IDEs are wired up, with query-only ones flagged inline (`ides: claude-code, antigravity (query-only)`).

### Windows

Claude Code runs hook commands through `sh -c` even on Windows. If Git for Windows' `Git\bin` isn't
on your user `Path`, `sh` doesn't resolve, hooks fail silently, and capture quietly stops — `cavemem
doctor`/`status` keep reporting healthy because the failure never reaches the CLI. Add
`C:\Program Files\Git\bin` (or `<scoop dir>\apps\git\current\usr\bin` for a Scoop install) to your
user `Path`, then verify with `where.exe sh`. `cavemem doctor` and `cavemem install` both check
`sh` resolvability on win32 and print a warning if it's missing.

Claude Code's hooks docs also describe a `shell` field (`"bash"` / `"powershell"`) and a shell-free
`args` exec form. We looked at emitting either instead of the plain `sh`-shaped command string, but
held off: we can't verify those fields against every Claude Code version in the wild, and the
current command has no shell metacharacters, so it already tokenizes the same way whether Claude
Code runs it through `sh` or falls back to PowerShell. Once there's a way to gate on a minimum
Claude Code version, switching to the shell-free `args` form would drop the `sh` dependency
entirely.

---

## How it works

```
session event  →  redact <private>  →  compress  →  SQLite + FTS5
                                                           ↑
                                                MCP queries on demand
```

What compression looks like in practice:

```
Input:  "The auth middleware throws a 401 when the session token expires; we should add a refresh path."
Stored: "auth mw throws 401 @ session token expires. add refresh path."
Viewed: "The auth middleware throws a 401 when session token expires. Add refresh path."
```

Code blocks, URLs, paths, identifiers, and version numbers are never touched. Hook handlers complete in under 150ms. Full bodies fetched on demand via `get_observations`.

---

## CLI

| Command | |
|---------|--|
| `cavemem install [--ide <name>]` | Register hooks + MCP for an IDE |
| `cavemem uninstall [--ide <name>]` | Remove hooks + MCP |
| `cavemem status` | Single dashboard: wiring, DB counts, embedding backfill, worker pid |
| `cavemem config show\|get\|set\|open` | View/edit settings — schema is self-documenting |
| `cavemem start\|stop\|restart` | Control the worker daemon (usually unnecessary — auto-starts) |
| `cavemem viewer` | Open the memory viewer in your browser |
| `cavemem doctor` | Verify installation |
| `cavemem search <query> [--limit N] [--no-semantic]` | Search memory (BM25 + cosine re-rank) |
| `cavemem compress <file>` | Compress a file with caveman grammar |
| `cavemem reindex` | Rebuild FTS5 + vector index |
| `cavemem export <out.jsonl>` | Dump sessions + observations to JSONL |
| `cavemem import <file.jsonl> [--dry-run]` | Load a JSONL export back in (merge, safe to re-run) |
| `cavemem mcp` | Start MCP server (stdio) |

Manual cross-device transfer: on machine A, `cavemem export backup.jsonl`. Copy the file to machine B, then on B, stop the worker (`cavemem stop`), run `cavemem import backup.jsonl`, and restart it (`cavemem start`). Records already present are skipped, and imported observations whose ids clash with different local ones get fresh ids — nothing is overwritten, and importing the same file twice is a no-op. Imported observations keep their original compressed content and get picked up by the embedding backfill like any new write — vectors themselves aren't exported.

---

## MCP

Progressive disclosure: `search` and `timeline` return compact results; `get_observations` fetches full bodies.

| Tool | Returns |
|------|---------|
| `search(query, limit?)` | `[{id, score, snippet, session_id, ts}]` — BM25 + optional cosine re-rank |
| `timeline(session_id, around_id?, limit?)` | `[{id, kind, ts}]` |
| `get_observations(ids[], expand?)` | Full bodies, expanded by default |
| `list_sessions(limit?)` | `[{id, ide, cwd, started_at, ended_at}]` |

---

## Settings

`<cavemem home>/settings.json`, where the cavemem home directory resolves in this order:

1. `CAVEMEM_HOME` env var, if set.
2. An existing `~/.cavemem` — zero breaking change for current installs.
3. `$XDG_DATA_HOME/cavemem` whenever `XDG_DATA_HOME` is explicitly set — on any platform,
   not just Linux. Without the var, Linux uses the XDG default `~/.local/share/cavemem`;
   macOS/Windows keep `~/.cavemem`.

Non-absolute env values (no leading `/` or `~`) are ignored, per the XDG spec — otherwise
hooks running from a project directory would fragment the store per-project.

Run `cavemem doctor` or `cavemem status` to see which directory is actually in use.

| Key | Default | |
|-----|---------|--|
| `dataDir` | resolved cavemem home (above) | SQLite database, models, pidfile, logs — set this explicitly (e.g. `"~/.cavemem"`) to relocate just the data, independent of where `settings.json` lives. Only an explicit value is written to `settings.json`; the default is re-resolved on every load, so the file stays portable across machines |
| `compression.intensity` | `"full"` | `lite` / `full` / `ultra` |
| `compression.expandForModel` | `false` | Return expanded text to model |
| `embedding.provider` | `"local"` | `local` / `ollama` / `openai` |
| `workerPort` | `37777` | Local viewer port |
| `search.alpha` | `0.5` | BM25 / vector blend |
| `search.defaultLimit` | `10` | Default result count |
| `privacy.excludePatterns` | `[]` | Path globs (e.g. `["**/.env", "**/secrets/**"]`) never captured |
| `privacy.redactSecrets` | `true` | Scrub secret-shaped substrings (API keys, tokens, passwords) with `[REDACTED]` |
| `capture.excludeTools` | `[]` | Tool names/globs never captured; wins over `includeTools` |
| `capture.includeTools` | `[]` | If non-empty, only these tool names/globs are captured |

Content inside `<private>...</private>` is stripped before write. Paths matching `excludePatterns` are never captured into memory, whether they appear in a tool's `file_path`/`path`/`notebook_path` field or embedded in a command string. The worker binds to `127.0.0.1` only, checks the Host/Origin headers on every request, and requires a local bearer token (`<dataDir>/worker-token`, mode `0600`) on `/api/*`.

---

## 🪨 The Caveman Ecosystem

Four tools. One philosophy: **agent do more with less**.

| Repo | What | One-liner |
|------|------|-----------|
| [**caveman**](https://github.com/JuliusBrussee/caveman) | Output compression skill | *why use many token when few do trick* — ~75% fewer output tokens across Claude Code, Cursor, Gemini, Codex |
| [**cavemem**](https://github.com/JuliusBrussee/cavemem) *(you are here)* | Cross-agent persistent memory | *why agent forget when agent can remember* — compressed SQLite + MCP, local by default |
| [**cavekit**](https://github.com/JuliusBrussee/cavekit) | Spec-driven autonomous build loop | *why agent guess when agent can know* — natural language → kits → parallel build → verified |
| [**cavegemma**](https://github.com/JuliusBrussee/finetune-caveman) | Gemma 4 31B fine-tuned on caveman pairs | *why prompt every turn when weight remember* — LoRA + merged bf16 on HF, no system prompt needed |

They compose: **cavekit** orchestrates the build, **caveman** compresses what the agent *says*, **cavemem** compresses what the agent *remembers*, **cavegemma** bakes the compression into the model weights. Install one, some, or all — each stands alone.

## Also by Julius Brussee

- [**Revu**](https://github.com/JuliusBrussee/revu-swift) — local-first macOS study app with FSRS spaced repetition. [revu.cards](https://revu.cards)

## License

MIT
