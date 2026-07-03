---
'@cavemem/storage': patch
'@cavemem/hooks': patch
'cavemem': patch
---

fix(hooks,storage): scope session-start prior-session context to current cwd (#39)

The `session-start` hook surfaced "Prior-session context" pulled from the
most recent N sessions across **all** projects on the machine. Opening
Claude Code in project A could inject summaries from last night's project B
session into the new kickoff, even though every session row already stores
`cwd`. Now `session-start.ts` widens the initial lookup from 4 → 20 and
filters by exact-`cwd` match before picking the top 3, falling back to the
old global behaviour only when the payload contains no `cwd` (so non-Claude
Code IDEs are unaffected).

`Storage.searchFts(query, limit, cwd?)` also gained an optional `cwd`
parameter that joins `sessions` and restricts hits to that project; default
behaviour without `cwd` is unchanged.
