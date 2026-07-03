---
'cavemem': patch
---

fix(cli): ship optionalDependencies in the legacy pack-release flow

`pack-release.mjs` rebuilt the published `package.json` from a hardcoded
allowlist that only read `dependencies`, silently dropping
`optionalDependencies` — so a `pnpm publish:release` tarball could never
install `@huggingface/transformers` and the local embedding provider was
dead on arrival for that publish path. The CI `changeset publish` path was
unaffected. Optional deps now pass through verbatim.
