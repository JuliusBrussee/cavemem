---
'@cavemem/storage': patch
'cavemem': patch
---

Bump `better-sqlite3` to `^12.10.0` so prebuilt binaries cover Node 24 (ABI 133) and Node 25 (ABI 137).

`better-sqlite3@11.x` ships prebuilts only up to Node 22, so installs on
Node 24+ fall through to a source build via `node-gyp`. On Windows that
requires Visual Studio Build Tools with the "Desktop development with C++"
workload; without it `npm install -g cavemem` fails with
`Could not find any Visual Studio installation to use`.

`better-sqlite3@12.10.0` publishes a `node-v137-win32-x64` prebuilt
(and matching Linux/macOS variants), so `npm install -g cavemem` succeeds
on Node 25 without any native toolchain.

The 12.x major dropped Node.js 18 only — `engines.node >= 20.0.0` is
unchanged, and no API used by `@cavemem/storage` (`prepare`, `run`, `get`,
`all`, `exec`, `transaction`, `pragma`) changed between 11.x and 12.x.
