---
'@cavemem/installers': patch
'cavemem': patch
---

Fix Windows hook commands silently failing in Claude Code (#43).

The Claude Code installer wrote hook command strings using Windows
backslash paths (`C:\Users\hp\…\node.exe …`). Claude Code runs hook
commands through bash on Windows (git-bash via MINGW64). Bash applies
escape processing to the string and drops any backslash followed by an
undefined-escape character — turning `C:\Users\hp\scoop\…` into
`C:Usershpscoop…`, so every hook fired with:

```
/usr/bin/bash: line 1: C:Usershpscoopappsnodejscurrentnode.exe:
  command not found
```

Fixed by normalizing paths to forward slashes (new `posixPath()` helper
in `@cavemem/installers`) before quoting them into the shell-string
`command` field. Windows `CreateProcess` accepts forward-slash paths,
so this works in cmd.exe, PowerShell, and bash with no platform-conditional
logic. The MCP `command` + `args[]` entry is unaffected because it's a
direct spawn (no shell).
