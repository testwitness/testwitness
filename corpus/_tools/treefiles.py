#!/usr/bin/env python3
"""Copy unchanged test files that a config pattern selects into files/base and files/head (identical copies).
The corpus runner materialises only changed files, so a C001 exclusion would otherwise match nothing in the
head tree. usage: treefiles.py <slug> <glob> [<glob> ...]   (globs are matched against the head tree with the
same rules as files.py; at most 200 files). Copies are written unedited from the git mirror and recorded in
files/tree.json so NOTES.md and reviewers can tell them from changed files."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(os.path.dirname(HERE), "entries")
MIRRORS = "/tmp/corpus-repos"
def to_re(g):
    r = ''; i = 0
    while i < len(g):
        if g.startswith('**/', i): r += '(?:.*/)?'; i += 3
        elif g.startswith('**', i): r += '.*'; i += 2
        elif g[i] == '*': r += '[^/]*'; i += 1
        else: r += re.escape(g[i]); i += 1
    return re.compile('^' + r + '$')
slug, globs = sys.argv[1], sys.argv[2:]
d = f"{ROOT}/{slug}"; p = json.load(open(f"{d}/pr.json"))
g = f"{MIRRORS}/{p['repo'].replace('/','-')}.git"
paths = subprocess.run(["git","ls-tree","-r","--name-only",p["head_sha"]], cwd=g, capture_output=True, text=True, check=True).stdout.splitlines()
changed = {m["path"] for m in json.load(open(f"{d}/files/manifest.json"))} | {m.get("oldPath") for m in json.load(open(f"{d}/files/manifest.json"))}
rs = [to_re(x) for x in globs]
picked = [x for x in paths if any(r.match(x) for r in rs) and x not in changed][:200]
for x in picked:
    data = subprocess.run(["git","show",f"{p['head_sha']}:{x}"], cwd=g, capture_output=True, check=True).stdout
    for side in ("base", "head"):
        os.makedirs(os.path.dirname(f"{d}/files/{side}/{x}"), exist_ok=True)
        open(f"{d}/files/{side}/{x}", "wb").write(data)
tf = f"{d}/files/tree.json"
old = json.load(open(tf)) if os.path.exists(tf) else []
json.dump(sorted(set(old) | set(picked)), open(tf, "w"), indent=2)
print(f"{slug}: {len(picked)} unchanged files copied for {globs}")
