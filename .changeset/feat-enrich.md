---
'@cavemem/compress': minor
'@cavemem/config': minor
'@cavemem/mcp-server': minor
'cavemem': minor
---

Opt-in web-search enrichment MCP tool (#55), phase 1.

- **config (#55):** New `enrich` settings block: `enrich.enabled` (default `false`), `enrich.maxResults` (default 3, max 5), `enrich.timeoutMs` (default 8000). Off by default — when off, the enrich MCP tool is not registered and no network call is ever made. Picked up automatically by `cavemem config show` / `settingsDocs()`.
- **compress (#55):** New `redactSecrets(text)` export that masks common API-key shapes (OpenAI/Stripe `sk-…`, GitHub `ghp_`/`github_pat_`, AWS `AKIA…`, Slack `xox…`) as `[REDACTED]`. Gated by `settings.privacy.redactSecrets` at call sites.
- **mcp-server (#55):** New `enrich(query, note?)` tool, registered only when `enrich.enabled` is `true`. Searches DuckDuckGo's HTML endpoint (no API key), parses the top results with a hand-rolled linear-time parser, fetches each result page with a 500 KB byte cap and per-request timeout, strips it to plain text, and truncates to 2000 chars. Extracts are stored through `MemoryStore.addObservation` (compressed, privacy-redacted) under a dedicated synthetic `enrich` session, tagged `metadata: { source: 'web', url, query, note? }` for provenance; `query`/`note` are run through `redactPrivate` + `redactSecrets` before storage, and source URLs survive compression byte-for-byte. The tool returns `{ query, results: [{ title, url, extract, observation_id }], stored_ids }`. **SSRF-hardened:** every fetched URL and each manually-followed redirect hop (max 3) must be http(s) to a public host — loopback, RFC1918, link-local (`169.254/16`), and unique-local targets (including obfuscated numeric literals) are rejected without a request. Search failure returns an MCP error with nothing stored; individual blocked or dead result pages are skipped.
