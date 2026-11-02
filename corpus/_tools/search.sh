#!/bin/bash
# usage: search.sh "<query>"  -> prints repo number title (merged PRs, newest first, 20 per query)
q="$1"
gh api -X GET search/issues -f q="$q is:pr is:merged" -f per_page=25 -f sort=updated \
  --jq '.items[] | "\(.repository_url | sub("https://api.github.com/repos/";""))\t\(.number)\t\(.title)"' 2>&1
