#!/usr/bin/env bash
# scripts/e2e-pack-release.sh
#
# End-to-end test of the LEGACY `pnpm publish:release` path. This is the
# bespoke publishing flow apps/cli ships in addition to changeset publish:
#
#   pnpm pack:release   -> build + scripts/pack-release.mjs (writes apps/cli/release/)
#   pnpm publish:release -> pack:release + npm publish ./release
#
# We dry-run the same artifact: pack the release dir into a tarball, install
# it into an isolated prefix, drive a hook, and run search. If you change
# pack-release.mjs or apps/cli/package.json's `dependencies` block, run this.
#
# Companion script:  bash scripts/e2e-publish.sh (covers the changeset path).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$REPO/.e2e"
PACK="$WORK/pack-release"
PREFIX="$WORK/prefix-release"
HOME_DIR="$WORK/home-release"

cleanup() {
  rm -rf "$PACK" "$PREFIX" "$HOME_DIR"
}
cleanup
mkdir -p "$PACK" "$PREFIX" "$HOME_DIR"

echo "==> 1. pack:release (build + pack-release.mjs)"
pnpm --filter cavemem pack:release >/dev/null

REL="$REPO/apps/cli/release"
test -f "$REL/package.json" || { echo "release dir missing package.json"; exit 1; }
test -f "$REL/README.md"    || { echo "release dir missing README.md"; exit 1; }
test -f "$REL/LICENSE"      || { echo "release dir missing LICENSE"; exit 1; }
test -d "$REL/hooks-scripts" || { echo "release dir missing hooks-scripts"; exit 1; }

echo "==> 2. npm pack the release dir (mirrors what publish:release uploads)"
VERSION=$(node -e "console.log(require('$REPO/apps/cli/package.json').version)")
( cd "$REL" && npm pack --pack-destination "$PACK" >/dev/null )
TGZ="$PACK/cavemem-$VERSION.tgz"
test -f "$TGZ" || { echo "tarball missing at $TGZ"; ls "$PACK"; exit 1; }

echo "==> 3. install -g into isolated prefix"
npm install --prefix "$PREFIX" --global "$TGZ" >/dev/null
BIN="$PREFIX/bin/cavemem"
test -x "$BIN" || { echo "bin shim missing"; exit 1; }

# Isolate $HOME and unset the env vars cavemem's home-dir resolution (issue
# #47) checks before it, so a real CAVEMEM_HOME / XDG_DATA_HOME in the
# caller's shell can't redirect this test outside the sandbox.
export HOME="$HOME_DIR"
unset CAVEMEM_HOME XDG_DATA_HOME

echo "==> 4. version"
"$BIN" --version

echo "==> 5. mcp launches"
out=$("$BIN" mcp </dev/null 2>&1 || true)
if echo "$out" | grep -q "Invalid or unexpected token"; then
  echo "FAIL: mcp crashed: $out"
  exit 1
fi

echo "==> 6. install + hook + search round trip"
"$BIN" install --ide claude-code >/dev/null
echo '{"session_id":"r","hook_event_name":"UserPromptSubmit","prompt":"check /etc/hosts"}' \
  | "$BIN" hook run user-prompt-submit --ide claude-code
"$BIN" search "hosts" | grep -q "hosts" || { echo "search returned no hits"; exit 1; }

echo "==> 7. doctor reports healthy"
"$BIN" doctor

echo
echo "publish:release ARTIFACT VERIFIED"
cleanup
