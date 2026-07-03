#!/usr/bin/env bash
# scripts/e2e-publish.sh
#
# End-to-end test of the *published* npm artifact:
#   1. build → stage → npm pack    (mirrors what changeset publish does)
#   2. npm install -g into an isolated prefix
#   3. drive every Claude Code hook event with realistic payloads
#   4. verify install/uninstall, search (FTS / better-sqlite3), MCP launch
#
# This catches the things `pnpm test` cannot:
# - bin shim symlink resolution (the entrypoint guard must compare realpaths)
# - chunk shebangs (one shebang per ESM file, never two)
# - prepublishOnly staging (README, LICENSE, hooks-scripts in the tarball)
# - better-sqlite3 native module resolution from a global install
# - dynamic import of bundled @cavemem/* sub-modules
#
# Run from repo root:  bash scripts/e2e-publish.sh
# Requires: node >= 20, npm, pnpm
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$REPO/.e2e"
PACK="$WORK/pack"
PREFIX="$WORK/prefix"
HOME_DIR="$WORK/home"

cleanup() {
  rm -rf "$PREFIX" "$HOME_DIR" "$PACK"
}
cleanup
mkdir -p "$PACK" "$PREFIX" "$HOME_DIR"

cd "$REPO"

# Embedding backfill needs the worker daemon to run. We disable autoSpawn
# during hook runs so the e2e stays deterministic — the test drives the
# worker explicitly in the checks below.
export CAVEMEM_NO_AUTOSTART=1

echo "==> 1. build everything"
pnpm build >/dev/null

echo "==> 2. stage publish files (README, LICENSE, hooks-scripts)"
pnpm --filter cavemem stage-publish

echo "==> 3. npm pack from apps/cli"
VERSION=$(node -e "console.log(require('$REPO/apps/cli/package.json').version)")
( cd "$REPO/apps/cli" && npm pack --pack-destination "$PACK" >/dev/null )
TGZ="$PACK/cavemem-$VERSION.tgz"
test -f "$TGZ" || { echo "tarball missing at $TGZ"; ls "$PACK"; exit 1; }

echo "==> 4. inspect tarball contents"
tar -tzf "$TGZ" | sort

echo "==> 5. install -g into isolated prefix"
npm install --prefix "$PREFIX" --global "$TGZ" >/dev/null
BIN="$PREFIX/bin/cavemem"
test -x "$BIN" || { echo "bin shim missing"; exit 1; }

# All subsequent commands run in an isolated $HOME so we never touch the real ~/.cavemem
# or a real XDG data dir — cavemem's home-dir resolution (issue #47) checks
# CAVEMEM_HOME / XDG_DATA_HOME before falling back to $HOME, either of which
# could otherwise point outside this sandbox if set in the caller's shell.
export HOME="$HOME_DIR"
unset CAVEMEM_HOME XDG_DATA_HOME

echo "==> 6. version (must match apps/cli/package.json#version)"
EXPECTED_VERSION=$(node -e "console.log(require('$REPO/apps/cli/package.json').version)")
ACTUAL_VERSION=$("$BIN" --version)
test "$ACTUAL_VERSION" = "$EXPECTED_VERSION" || {
  echo "version mismatch: bin reports '$ACTUAL_VERSION', package.json says '$EXPECTED_VERSION'"
  exit 1
}
echo "$ACTUAL_VERSION"

echo "==> 7. install --ide claude-code"
"$BIN" install --ide claude-code

echo "==> 8. claude settings written"
test -f "$HOME/.claude/settings.json"
grep -q "hook run session-start --ide claude-code" "$HOME/.claude/settings.json"

echo "==> 9. drive full hook lifecycle"
echo '{"session_id":"e2e","hook_event_name":"SessionStart","source":"startup","cwd":"/tmp"}' | "$BIN" hook run session-start --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"UserPromptSubmit","prompt":"Edit the broken /etc/hosts file"}' | "$BIN" hook run user-prompt-submit --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.ts"},"tool_response":{"success":true}}' | "$BIN" hook run post-tool-use --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"Stop","last_assistant_message":"shipped the migration"}' | "$BIN" hook run stop --ide claude-code
echo '{"session_id":"e2e","hook_event_name":"SessionEnd","reason":"logout"}' | "$BIN" hook run session-end --ide claude-code

echo "==> 10. resume idempotency (same session_id, source=resume)"
echo '{"session_id":"e2e","hook_event_name":"SessionStart","source":"resume"}' | "$BIN" hook run session-start --ide claude-code

echo "==> 11. new session emits hookSpecificOutput JSON to stdout"
out=$(echo '{"session_id":"e2e-2","hook_event_name":"SessionStart","source":"startup"}' | "$BIN" hook run session-start --ide claude-code 2>/dev/null)
echo "$out" | grep -q '"hookSpecificOutput"' || { echo "missing hookSpecificOutput"; exit 1; }
echo "$out" | grep -q '"additionalContext"' || { echo "missing additionalContext"; exit 1; }

echo "==> 12. search via FTS (better-sqlite3 native)"
"$BIN" search "hosts" | grep -q "hosts" || { echo "FTS search returned no hits"; exit 1; }

echo "==> 13. doctor reports healthy"
"$BIN" doctor

echo "==> 13b. status command runs and reports observation count"
"$BIN" status

echo "==> 13c. config show works and includes descriptions"
"$BIN" config show | grep -q "embedding.provider" || { echo "config show missing embedding.provider"; exit 1; }
"$BIN" config path | grep -q "settings.json" || { echo "config path broken"; exit 1; }

echo "==> 14. MCP server launches without crashing on init"
HOME="$HOME_DIR" "$BIN" mcp </dev/null >/dev/null 2>&1 &
mcp_pid=$!
sleep 0.4
if ! kill -0 $mcp_pid 2>/dev/null; then
  wait $mcp_pid || true
  # If mcp errored on a closed stdin that's actually fine — but fail loudly
  # if it crashed with the chunk-shebang syntax error we used to ship.
  out=$("$BIN" mcp </dev/null 2>&1 || true)
  if echo "$out" | grep -q "Invalid or unexpected token"; then
    echo "FAIL: mcp crashed with shebang syntax error: $out"
    exit 1
  fi
fi
kill $mcp_pid 2>/dev/null || true
wait $mcp_pid 2>/dev/null || true

echo "==> 15. uninstall cleans up settings"
"$BIN" uninstall --ide claude-code
grep -q "cavemem" "$HOME/.claude/settings.json" && { echo "uninstall left cavemem entry"; exit 1; }

echo
echo "ALL CHECKS PASSED"
cleanup
