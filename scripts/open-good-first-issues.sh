#!/usr/bin/env bash
# Opens the ten issues from docs/good-first-issues.md on testwitness/testwitness.
# Maintainer only. Needs gh, logged in. Safe to rerun: skips titles that already exist.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
repo="testwitness/testwitness"
gh label create "good first issue" --repo "$repo" --color 7057ff --description "Small, well scoped, mentored" 2>/dev/null || true
python3 - "$repo" <<'PY'
import re, subprocess, sys
repo = sys.argv[1]
text = open("docs/good-first-issues.md", encoding="utf-8").read()
parts = re.split(r"^## \d+\. ", text, flags=re.M)[1:]
existing = subprocess.run(["gh", "issue", "list", "--repo", repo, "--state", "all", "--limit", "500", "--json", "title", "--jq", ".[].title"], check=True, capture_output=True, text=True).stdout.splitlines()
for part in parts:
    title, _, body = part.partition("\n")
    title = title.strip()
    if title in existing:
        print("exists:", title); continue
    body = body.strip() + "\n\nSee docs/good-first-issues.md and docs/conventions.md to get started."
    url = subprocess.run(["gh", "issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", "good first issue"], check=True, capture_output=True, text=True).stdout.strip()
    print("opened:", url)
PY
