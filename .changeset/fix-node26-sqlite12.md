---
'@cavemem/storage': patch
'cavemem': patch
---

Bump better-sqlite3 from ^11.5.0 to ^12.0.0 for Node 26 compatibility.

Node 26 removes three V8 APIs that better-sqlite3 ≤11.x relied on
(`v8::Object::GetPrototype`, `v8::Context::GetIsolate`,
`v8::PropertyCallbackInfo<T>::This`). The native addon fails to compile
with a hard `error C2039` / `error: 'GetPrototype' is not a member` on
Node 26. better-sqlite3 12.x rewrites those call sites and compiles
cleanly on Node 20 through 26. The Storage API surface used by this
repo (`.prepare`, `.run`, `.get`, `.all`, `.exec`) is unchanged across
v11→v12 — no other edits required.
