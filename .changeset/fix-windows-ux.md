---
'@cavemem/installers': patch
'cavemem': patch
---

fix(cli,installers): warn loudly when `sh` is missing on Windows (#56, #57)

Claude Code wraps hook `command` strings in `sh -c` even on Windows. If Git
for Windows' `Git\bin` isn't on the user's `Path`, `sh` doesn't resolve,
every hook fails non-blocking, and cavemem silently stops capturing memory —
`cavemem doctor` and `cavemem status` kept reporting healthy because the
failure never reached the CLI (#56).

`checkWindowsSh()` (new, `@cavemem/installers`) checks `sh` resolvability on
win32 with an injectable resolver for testing; it's a no-op on every other
platform. `cavemem doctor` now runs it and exits non-zero with a loud
warning + the one-time fix (`C:\Program Files\Git\bin`, or the Scoop
`usr\bin` equivalent, onto user `Path`; verify with `where.exe sh`).
`cavemem install --ide claude-code` runs the same check and prints the same
warning, but does not refuse to install — the user may fix `Path` afterward
and hooks will start working without a re-install.

**#57 (pwsh emission):** investigated switching the emitted hook `command`
to Claude Code's newer `shell` field (`"bash"` / `"powershell"`) or its
shell-free `args` exec form. Held off: we can't verify either against every
installed Claude Code version, and the current command has no shell
metacharacters, so it already tokenizes identically whether Claude Code
runs it through `sh` or falls back to PowerShell. The #56 fix above — make
the missing-`sh` failure loud instead of silent — is the actionable part we
could ship with confidence. See the Windows note in the README and the
comment in `packages/installers/src/claude-code.ts` for the full reasoning.
