#!/usr/bin/env python3
"""Paced GitHub search helper shared by search.sh and ingest.py.
usage: ghsearch.py issues "<query>" [per_page]   merged PRs, prints repo, number, stars?, title; caches items
       ghsearch.py repos owner/repo [owner/repo ...] caches repository metadata (stars, licence) in batches
Every call waits until at least 9.5 s after the previous search call of any process on this machine,
and waits 20 s before retrying after a 403 or 429. Items are cached under /tmp/corpus-repos so that
ingest.py does not search again for a PR already seen in a result list."""
import fcntl, json, os, subprocess, sys, time
MIRRORS = "/tmp/corpus-repos"
LOCK = "/tmp/corpus-search.lock"
STAMP = "/tmp/corpus-search.last"
GAP = 9.5
os.makedirs(MIRRORS, exist_ok=True)

def call(args):
    for attempt in range(4):
        with open(LOCK, "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            last = float(open(STAMP).read() or 0) if os.path.exists(STAMP) else 0.0
            wait = last + GAP - time.time()
            if wait > 0: time.sleep(wait)
            r = subprocess.run(["gh", "api", "-X", "GET", *args], capture_output=True, text=True)
            open(STAMP, "w").write(str(time.time()))
            if r.returncode == 0: return json.loads(r.stdout)
            err = r.stderr + r.stdout
            if "403" in err or "429" in err or "rate limit" in err.lower():
                open(STAMP, "w").write(str(time.time() + 20 - GAP))
                continue
            raise SystemExit(f"search failed: {err.strip()[:300]}")
    raise SystemExit("search failed after retries (rate limited)")

def issue_cache_path(repo, num):
    return f"{MIRRORS}/pr-{repo.replace('/', '-')}-{num}.json"

def issues(q, per_page="30"):
    d = call(["search/issues", "-f", f"q={q} is:pr is:merged", "-f", f"per_page={per_page}", "-f", "sort=updated"])
    for it in d.get("items", []):
        repo = it["repository_url"].split("/repos/", 1)[1]
        json.dump(it, open(issue_cache_path(repo, it["number"]), "w"))
        meta = f"{MIRRORS}/meta-{repo.replace('/', '-')}.json"
        stars = lic = "?"
        if os.path.exists(meta):
            m = json.load(open(meta)); stars = m["stargazers_count"]; lic = (m.get("license") or {}).get("spdx_id")
        print(f"{repo}\t{it['number']}\t{stars}\t{lic}\t{it['title'][:110]}")

def repos(names):
    names = [n for n in names if not os.path.exists(f"{MIRRORS}/meta-{n.replace('/', '-')}.json")]
    for i in range(0, len(names), 5):
        chunk = names[i:i + 5]
        d = call(["search/repositories", "-f", "q=" + " ".join(f"repo:{n}" for n in chunk), "-f", "per_page=10"])
        for it in d.get("items", []):
            json.dump(it, open(f"{MIRRORS}/meta-{it['full_name'].replace('/', '-')}.json", "w"))
    for n in sys.argv[2:]:
        p = f"{MIRRORS}/meta-{n.replace('/', '-')}.json"
        if os.path.exists(p):
            m = json.load(open(p)); print(f"{n}\t{m['stargazers_count']}\t{(m.get('license') or {}).get('spdx_id')}")
        else: print(f"{n}\tnot found")

if __name__ == "__main__":
    if sys.argv[1] == "issues": issues(sys.argv[2], *(sys.argv[3:4]))
    elif sys.argv[1] == "repos": repos(sys.argv[2:])
    elif sys.argv[1] == "raw": print(json.dumps(call(sys.argv[2:])))
