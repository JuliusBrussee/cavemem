---
"@cavemem/embedding": patch
"cavemem": patch
---

Migrate the local embedding provider from `@xenova/transformers@2` to `@huggingface/transformers@3`.

`@xenova/transformers` is deprecated and pins an old `onnxruntime-web` →
`onnx-proto` → `protobufjs` chain carrying 5 published advisories (4 high,
1 critical) plus a `qs` moderate. `@huggingface/transformers@3` is the
maintained successor: same `pipeline()` / `env` API, but uses
`onnxruntime-node` directly, dropping the vulnerable web/proto chain.

The v2 `quantized: true` pipeline flag was removed in v3; it is replaced with
`dtype: 'q8'` (int8 weights, matching the old quantized default). Embedding
output is unchanged — same model (`Xenova/all-MiniLM-L6-v2`), same 384 dims —
so existing stored vectors stay compatible and no re-embed is triggered.
