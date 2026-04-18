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
  <a href="https://github.com/JuliusBrussee/cavekit">cavekit</a> <em>build better</em>
</p>


---

Cross-agent persistent memory for coding assistants. Hooks fire at session boundaries, compress observations with the caveman grammar (~75% fewer prose tokens, code and paths preserved byte-for-byte), and write to local SQLite. Agents query their own history through three MCP tools. No network. No cloud.

**Supports:** Claude Code · Cursor · Gemini CLI · OpenCode · Codex

- **Persistent memory across sessions.** Hooks capture what happened; the store keeps it.
- **Compressed at rest.** Deterministic caveman grammar, round-trip-guaranteed expansion for humans.
- **Progressive MCP retrieval.** `search`, `timeline`, `get_observations` — agents filter before fetching.
- **Hybrid search.** SQLite FTS5 keyword + local vector index, combined with a tunable ranker.
- **Local by default.** No network calls. Optional remote embedding providers via config.
- **Web viewer.** Read-only UI at `http://localhost:37777` for browsing sessions in human-readable form.
- **Cross-IDE installers.** Claude Code, Gemini CLI, OpenCode, Codex, Cursor — one command each.
- **Privacy-aware.** `<private>...</private>` stripped at write boundary. Path globs exclude whole directories.

---

## Install

```sh
npm install -g cavemem
cavemem install                    # Claude Code
cavemem install --ide cursor       # cursor | gemini-cli | opencode | codex
cavemem doctor                     # verify
```

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
| `cavemem doctor` | Verify installation |
| `cavemem search <query> [--limit N]` | Search memory from terminal |
| `cavemem compress <file>` | Compress a file with caveman grammar |
| `cavemem reindex` | Rebuild FTS5 + vector index |
| `cavemem export <out.jsonl>` | Dump observations to JSONL |
| `cavemem worker` | Start local viewer (http://127.0.0.1:37777) |
| `cavemem mcp` | Start MCP server (stdio) |

---

## MCP

Progressive disclosure: `search` and `timeline` return compact results; `get_observations` fetches full bodies.

| Tool | Returns |
|------|---------|
| `search(query, limit?)` | `[{id, score, snippet, session_id, ts}]` |
| `timeline(session_id, around_id?, limit?)` | `[{id, kind, ts}]` |
| `get_observations(ids[], expand?)` | Full bodies, expanded by default |

---

## Settings

`~/.cavemem/settings.json`

| Key | Default | |
|-----|---------|--|
| `dataDir` | `"~/.cavemem"` | SQLite location |
| `compression.intensity` | `"full"` | `lite` / `full` / `ultra` |
| `compression.expandForModel` | `false` | Return expanded text to model |
| `embedding.provider` | `"local"` | `local` / `ollama` / `openai` |
| `workerPort` | `37777` | Local viewer port |
| `search.alpha` | `0.5` | BM25 / vector blend |
| `search.defaultLimit` | `10` | Default result count |
| `privacy.excludePatterns` | `[]` | Paths never captured |

Content inside `<private>...</private>` is stripped before write. Paths matching `excludePatterns` are never read. The worker binds to `127.0.0.1` only.

---

## 🪨 The Caveman Ecosystem

Three tools. One philosophy: **agent do more with less**.

| Repo | What | One-liner |
|------|------|-----------|
| [**caveman**](https://github.com/JuliusBrussee/caveman) | Output compression skill | *why use many token when few do trick* — ~75% fewer output tokens across Claude Code, Cursor, Gemini, Codex |
| [**cavemem**](https://github.com/JuliusBrussee/cavemem) *(you are here)* | Cross-agent persistent memory | *why agent forget when agent can remember* — compressed SQLite + MCP, local by default |
| [**cavekit**](https://github.com/JuliusBrussee/cavekit) | Spec-driven autonomous build loop | *why agent guess when agent can know* — natural language → kits → parallel build → verified |

They compose: **cavekit** orchestrates the build, **caveman** compresses what the agent *says*, **cavemem** compresses what the agent *remembers*. Install one, some, or all — each stands alone.

## Also by Julius Brussee

- [**Revu**](https://github.com/JuliusBrussee/revu-swift) — local-first macOS study app with FSRS spaced repetition. [revu.cards](https://revu.cards)

## License

MIT
