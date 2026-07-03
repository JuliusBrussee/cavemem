---
'@cavemem/config': patch
'cavemem': minor
---

fix(worker): authenticate the local viewer HTTP API and allow disabling idle shutdown (#51, #32)

**#51 — unauthenticated worker HTTP API.** The worker's viewer (`127.0.0.1:<workerPort>`)
served `/api/sessions`, `/api/sessions/:id/observations` (expanded, human-readable
bodies), and `/api/search` with no auth, reachable by any local process or by a
malicious web page doing a DNS-rebinding / CSRF fetch. `apps/worker` now applies
defense in depth on every request:

- A Host-header allowlist rejects (403) anything but `127.0.0.1:<port>` /
  `localhost:<port>`, closing the DNS-rebinding path.
- An Origin check rejects (403) any present Origin that isn't
  `http://127.0.0.1:<port>` / `http://localhost:<port>` — no CORS headers are added.
- `/api/*` now requires `Authorization: Bearer <token>` or `X-Cavemem-Token`. The
  token is generated once with `crypto.randomBytes(32)`, persisted at
  `<dataDir>/worker-token` (mode `0600`), and reused across restarts.

The plain HTML viewer pages (`/`, `/sessions/:id`) stay token-free for zero-friction
browsing — the worker injects `window.__CAVEMEM_TOKEN__` into the served HTML so any
client-side code can call `/api/*` without the user doing anything. `cavemem viewer`
and `cavemem status` were already file/pid-based and needed no changes; neither
`apps/cli` nor `packages/hooks` call the worker over HTTP.

**#32 — no way to disable idle shutdown.** `embedding.idleShutdownMs` previously had
to be a positive number, so the worker always self-exited after being idle. Setting
it to `0` now disables idle shutdown entirely (the worker runs until killed);
negative values are clamped to `0`.
