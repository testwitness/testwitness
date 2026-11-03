#!/usr/bin/env bash
# Rewrite every commit's author and committer to the given name and email.
# Usage: scripts/rewrite-authors.sh "Sajjad Hossain" "<id>+<user>@users.noreply.github.com"
# Run once, before the first push. Rewrites history; a clone made before this run will not fast forward.
set -euo pipefail
NAME="${1:?name}"
EMAIL="${2:?email}"
if git filter-repo --version >/dev/null 2>&1; then
  git filter-repo --force --commit-callback "
commit.author_name = b'${NAME}'
commit.author_email = b'${EMAIL}'
commit.committer_name = b'${NAME}'
commit.committer_email = b'${EMAIL}'
"
else
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter "
export GIT_AUTHOR_NAME='${NAME}' GIT_AUTHOR_EMAIL='${EMAIL}' GIT_COMMITTER_NAME='${NAME}' GIT_COMMITTER_EMAIL='${EMAIL}'
" -- --all
  rm -rf .git/refs/original
fi
git config user.name "${NAME}"
git config user.email "${EMAIL}"
echo "rewritten: $(git rev-list --all --count) commits now by ${NAME} <${EMAIL}>"
git log --format='%an <%ae>' | sort | uniq -c
