---
'@cavemem/hooks': patch
'cavemem': patch
---

fix(cli,hooks): hide Windows console window on detached worker spawn (#11)

All four detached `child_process.spawn` sites (lifecycle `start`/`viewer`,
`worker start`, and the hooks auto-spawn path) now pass `windowsHide: true`.
Without this, `CreateProcess` on Windows pops a visible console window for
each detached child, which on some setups blocks `cavemem start` and every
hook auto-spawn. POSIX platforms ignore the option, so no behaviour change
on macOS/Linux.
