#!/usr/bin/env python3
"""Ingest a merged public PR into corpus/entries using gh search (metadata) and git (diff).
usage: ingest.py owner/repo number category [slug]
Refuses PRs over 2000 changed lines, repos under 100 stars, non permissive licences."""
import json, subprocess, sys, hashlib, os, re
ALLOWED = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
ROOT = "/home/claude/testwitness/corpus"
MIRRORS = "/tmp/corpus-repos"
EMAP = {".py":"python",".java":"java",".ts":"typescript",".tsx":"typescript",".js":"javascript",".jsx":"javascript",".mjs":"javascript",".cjs":"javascript",".kt":"kotlin",".go":"go",".rs":"rust",".cs":"csharp",".scala":"scala",".groovy":"groovy"}
def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if check and r.returncode != 0:
        raise SystemExit(f"FAIL {' '.join(cmd)}: {r.stderr.strip()[:300]}")
    return r.stdout
def main():
    repo, num, cat = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    slug = sys.argv[4] if len(sys.argv) > 4 else f"{repo.replace('/','-').lower()}-{num}"
    cache = f"{MIRRORS}/meta-{repo.replace('/','-')}.json"
    os.makedirs(MIRRORS, exist_ok=True)
    if os.path.exists(cache): r = json.load(open(cache))
    else:
        r = json.loads(run(["gh","api","-X","GET","search/repositories","-f",f"q=repo:{repo}"]))["items"][0]
        json.dump(r, open(cache,"w"))
    stars = r["stargazers_count"]; lic = (r.get("license") or {}).get("spdx_id")
    if stars < 100: print(f"SKIP {repo}#{num}: {stars} stars"); return
    if lic not in ALLOWED: print(f"SKIP {repo}#{num}: licence {lic}"); return
    items = json.loads(run(["gh","api","-X","GET","search/issues","-f",f"q=repo:{repo} is:pr {num}"]))["items"]
    items = [i for i in items if i["number"] == num]
    if not items: print(f"SKIP {repo}#{num}: not found by search"); return
    p = items[0]
    merged = p["pull_request"].get("merged_at")
    if not merged: print(f"SKIP {repo}#{num}: not merged"); return
    # git mirror (commits only, blobs on demand)
    g = f"{MIRRORS}/{repo.replace('/','-')}.git"
    if not os.path.exists(g):
        os.makedirs(g); run(["git","init","-q","--bare"], cwd=g)
        run(["git","remote","add","origin",f"https://github.com/{repo}"], cwd=g)
        run(["git","fetch","-q","--filter=tree:0","origin","HEAD:refs/heads/_default"], cwd=g)
    run(["git","fetch","-q","--filter=tree:0","origin",f"refs/pull/{num}/head:refs/pull/{num}/head"], cwd=g)
    head = run(["git","rev-parse",f"refs/pull/{num}/head"], cwd=g).strip()
    base = run(["git","merge-base","_default",head], cwd=g, check=False).strip()
    if base == head:
        # head was merged with a merge commit: find it and use its first parent as the base
        base = ""
        for line in run(["git","log","--format=%H %P","_default"], cwd=g).splitlines():
            parts = line.split()
            if head in parts[2:]:
                base = run(["git","merge-base",parts[1],head], cwd=g).strip(); break
        if not base:
            print(f"SKIP {repo}#{num}: head is on the first parent chain, cannot recover base"); return
    if not base:
        print(f"SKIP {repo}#{num}: no merge base with default branch"); return
    stat = run(["git","diff","--numstat",base,head], cwd=g)
    adds = dels = 0; files = []
    for line in stat.splitlines():
        a, d, f = line.split("\t", 2)
        files.append(f)
        if a != "-": adds += int(a); dels += int(d)
    if adds + dels > 2000: print(f"SKIP {repo}#{num}: {adds+dels} changed lines"); return
    if not files: print(f"SKIP {repo}#{num}: empty diff"); return
    diff = run(["git","diff",base,head], cwd=g)
    url = p["html_url"]
    split = "tuning" if int(hashlib.sha256(url.encode()).hexdigest(), 16) % 2 == 0 else "heldout"
    counts = {}
    for f in files:
        e = os.path.splitext(f)[1]
        if e in EMAP: counts[EMAP[e]] = counts.get(EMAP[e], 0) + 1
    language = max(counts, key=counts.get) if counts else (r.get("language") or "unknown").lower()
    entry = {"url": url, "repo": repo, "number": num, "title": p["title"], "merged_at": merged,
             "stars": stars, "license": lic, "language": language, "category": cat, "split": split,
             "base_sha": base, "head_sha": head, "files_changed": len(files),
             "additions": adds, "deletions": dels}
    d = f"{ROOT}/entries/{slug}"; os.makedirs(d, exist_ok=True)
    with open(f"{d}/pr.json", "w") as fh: json.dump(entry, fh, indent=2); fh.write("\n")
    open(f"{d}/pr.diff", "w").write(diff)
    print(f"OK {slug} [{cat}] {split} {language} lic={lic} stars={stars} +{adds} -{dels} files={len(files)}")
    for f in files: print("    ", f)
main()
