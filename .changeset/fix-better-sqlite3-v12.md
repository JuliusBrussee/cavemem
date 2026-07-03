---
'@cavemem/storage': patch
'cavemem': patch
---

fix(storage,cli): bump better-sqlite3 to ^12.0.0 for Node 26 (#37)

Node 26 removed three V8 C++ APIs (`v8::Object::GetPrototype`,
`v8::Context::GetIsolate`, `v8::PropertyCallbackInfo<T>::This`) that
better-sqlite3 ≤11.x relied on, so `npm install -g cavemem` fails with
`error C2039: 'GetPrototype': is not a member of 'v8::Object'` when there
is no prebuilt binary for the target Node ABI. better-sqlite3 v12 rewrites
those call sites and ships prebuilts for Node 20 through 26. The Storage
API surface used by this repo (`prepare`, `run`, `get`, `all`, `exec`,
FTS5, `bm25`, `snippet`, blob storage) is identical across v11 → v12, so
no code changes are needed.
