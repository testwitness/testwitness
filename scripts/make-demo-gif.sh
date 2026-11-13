#!/usr/bin/env bash
# Regenerates docs/public/demo.gif, the README demo, from a real run of the bundled CLI.
#
#   1. builds a throwaway git repo with a Vitest file and a second commit that skips one test,
#      loosens one assertion (toEqual to toBeDefined) and deletes one test
#   2. records a terminal session with asciinema in which the commands are typed out and then
#      really run: git diff, then the bundled testwitness CLI (packages/cli/bin/testwitness.js)
#   3. renders the recording to a GIF with agg
#
# Needs: node 22, git, asciinema (pip install asciinema) and agg
# (https://github.com/asciinema/agg/releases) on PATH, or AGG=/path/to/agg.
# No network at runtime. Run `pnpm bundle:cli` first, or pass --bundle to do it here.
#
#   scripts/make-demo-gif.sh [--bundle] [--keep]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/docs/public/demo.gif"
agg="${AGG:-agg}"
cols=100
rows=36
keep=0
for a in "$@"; do
  case "$a" in
    --bundle) (cd "$root" && node scripts/bundle-cli.mjs) ;;
    --keep) keep=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

cli="$root/packages/cli/bin/testwitness.js"
[ -f "$root/packages/cli/dist/cli.js" ] || { echo "no bundled CLI; run pnpm bundle:cli or pass --bundle" >&2; exit 1; }
command -v asciinema >/dev/null || { echo "asciinema not found (pip install asciinema)" >&2; exit 1; }
command -v "$agg" >/dev/null || { echo "agg not found (set AGG=/path/to/agg)" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/testwitness-demo-XXXXXX")"
[ "$keep" = 1 ] && echo "work dir: $work" || trap 'rm -rf "$work"' EXIT

# The demo repo. Fixed author and dates so the recording does not depend on the local git config.
repo="$work/shop"
mkdir -p "$repo/src" "$repo/test" "$work/bin"
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.com GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.com
export GIT_AUTHOR_DATE='2026-11-01T10:00:00Z' GIT_COMMITTER_DATE='2026-11-01T10:00:00Z'
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git -C "$repo" init -q -b main
cat > "$repo/src/cart.ts" <<'EOF'
export function total(items: { price: number; qty: number }[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function applyDiscount(amount: number, percent: number): number {
  return Math.round(amount * (100 - percent)) / 100;
}
EOF
cat > "$repo/test/cart.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest';
import { total, applyDiscount } from '../src/cart';

describe('cart', () => {
  it('sums price times quantity', () => {
    expect(total([{ price: 5, qty: 2 }, { price: 3, qty: 1 }])).toEqual(13);
  });

  it('applies a percentage discount', () => {
    expect(applyDiscount(200, 10)).toEqual(180);
  });

  it('returns zero for an empty cart', () => {
    expect(total([])).toBe(0);
  });

  it('rounds discounts to cents', () => {
    expect(applyDiscount(9.99, 15)).toEqual(8.49);
  });
});
EOF
git -C "$repo" add -A
git -C "$repo" commit -qm 'cart with tests'
git -C "$repo" checkout -qb agent/fix-discount
# What an agent might do to get a red build green: loosen one assertion, skip one test, delete one test.
cat > "$repo/test/cart.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest';
import { total, applyDiscount } from '../src/cart';

describe('cart', () => {
  it('sums price times quantity', () => {
    expect(total([{ price: 5, qty: 2 }, { price: 3, qty: 1 }])).toEqual(13);
  });

  it('applies a percentage discount', () => {
    expect(applyDiscount(200, 10)).toBeDefined();
  });

  it.skip('returns zero for an empty cart', () => {
    expect(total([])).toBe(0);
  });
});
EOF
git -C "$repo" commit -qam 'fix discount rounding'

# `testwitness` on PATH is the bundled CLI from this checkout.
printf '#!/bin/sh\nexec node %q "$@"\n' "$cli" > "$work/bin/testwitness"
chmod +x "$work/bin/testwitness"

# The session: each command is typed out character by character, then run for real.
cat > "$work/session.sh" <<'EOF'
cd "$DEMO_REPO"
type_run() {
  printf '\033[1;32m$\033[0m '
  local s="$1" i
  for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.03; done
  sleep 0.4
  printf '\n'
  eval "$1"
  sleep 1.6
}
sleep 0.5
type_run 'git diff -U1 main -- test/'
type_run 'testwitness check --base main'
printf '\033[1;32m$\033[0m '
sleep 2
EOF

cast="$work/demo.cast"
PATH="$work/bin:$PATH" DEMO_REPO="$repo" TERM=xterm-256color GIT_PAGER=cat \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=color.ui GIT_CONFIG_VALUE_0=always \
  asciinema rec --quiet --overwrite --cols "$cols" --rows "$rows" --command "bash --noprofile --norc $work/session.sh" "$cast"

mkdir -p "$(dirname "$out")"
"$agg" --cols "$cols" --rows "$rows" --font-size 16 --line-height 1.3 --theme github-dark \
  --idle-time-limit 2 --last-frame-duration 6 --fps-cap 15 "$cast" "$out"

# Report what was made, from the recording itself.
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
const last = JSON.parse(lines[lines.length - 1]);
const size = fs.statSync(process.argv[2]).size;
console.log(`${process.argv[2]}: ${(size / 1024).toFixed(0)} kB, recording ${last[0].toFixed(1)} s plus 6 s on the last frame`);
' "$cast" "$out"
