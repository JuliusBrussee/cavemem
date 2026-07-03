---
"@cavemem/embedding": patch
"cavemem": patch
---

Migrate the local embedding provider from `@xenova/transformers@2` to `@huggingface/transformers@3`.

`@xenova/transformers` is deprecated and pins an old `onnxruntime-web` →
`onnx-proto` → `protobufjs` chain carrying multiple published `protobufjs`
advisories, including a critical arbitrary-code-execution issue
(GHSA-xq3m-2v4x-88gg). `@huggingface/transformers@3` is the maintained
successor: same `pipeline()` / `env` API, but resolves a current, patched
`protobufjs`, clearing those advisories. (The unrelated `qs` moderate
advisory some audits report comes from `express`/`body-parser`, not this
dependency chain, and is unaffected by this change.)

The v2 `quantized: true` pipeline flag was removed in v3; it is replaced with
`dtype: 'q8'` (int8 weights, matching the old quantized default). Embedding
output is unchanged — same model (`Xenova/all-MiniLM-L6-v2`), same 384 dims —
so existing stored vectors stay compatible and no re-embed is triggered.
