#!/bin/bash
# usage: search.sh "<query>" [per_page]  -> prints repo, number, stars, licence, title (merged PRs, most recently updated first)
# Paced: at least 9.5 s between search calls, 20 s after a 403 or 429 (see ghsearch.py).
exec python3 -I "$(dirname "$0")/ghsearch.py" issues "$1" "${2:-30}"
