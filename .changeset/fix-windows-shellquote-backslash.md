---
'@cavemem/installers': patch
'cavemem': patch
---

fix(installers): quote Windows paths in hook commands even without spaces (#41)

`shellQuote` previously treated `\` as a bare-token character, so a default
Windows install path with no spaces was written unquoted into the hook
`command` string in `~/.claude/settings.json`. When Claude Code on Windows
runs the hook through MSYS-bash, unquoted backslashes are treated as escape
introducers and stripped, mangling the path
`C:\Users\...\node_modules\cavemem\dist\index.js` into
`CUsers...node_modulescavememdistindex.js` and the hook fails with
`MODULE_NOT_FOUND`. After this fix, any path containing a backslash gets
wrapped in double quotes; both cmd.exe and MSYS-bash preserve the
backslashes verbatim inside `"..."`. POSIX paths are unaffected.
