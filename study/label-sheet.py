#!/usr/bin/env python3
"""Draw the precision label set: a seeded random 100 PRs (20 per agent) and one
row per high or medium finding on those PRs, for two independent labellers.

usage: python3 -I study/label-sheet.py [--dir study] [--per-agent 20] [--seed 20261103]
Writes labels.csv (local only: it carries PR urls and test names so labellers
can read the change; it is never published). Labellers fill verdict_a and
verdict_b with tp (the change really weakened what the test checks), fp, or
unsure, without seeing each other's column, and use note for anything else.
"""
import csv, json, os, random, sys, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
DIR = os.path.abspath(args[args.index("--dir") + 1]) if "--dir" in args else HERE
PER_AGENT = int(args[args.index("--per-agent") + 1]) if "--per-agent" in args else 20
SEED = int(args[args.index("--seed") + 1]) if "--seed" in args else 20261103
AGENTS = ["claude-code", "copilot", "devin", "cursor", "codex"]


def slug(url):
    parts = url.rstrip("/").split("/")
    return f"{parts[3]}-{parts[4]}-{parts[6]}".lower()


def clip(s, n=1500):
    s = s or ""
    return s if len(s) <= n else s[:n] + "\n[cut]"


def main():
    with open(os.path.join(DIR, "results.csv")) as fh:
        rows = [r for r in csv.DictReader(fh) if not r["error"]]
    rnd = random.Random(SEED)
    drawn = []
    for a in AGENTS:
        pool = sorted(r["url"] for r in rows if r["agent"] == a)
        take = rnd.sample(pool, min(PER_AGENT, len(pool)))
        if len(take) < PER_AGENT:
            print(f"{a}: only {len(take)} PRs available")
        drawn += [(a, u) for u in take]
    out = []
    for a, url in drawn:
        rep = json.load(open(os.path.join(DIR, "data", slug(url), "report.json")))
        for f in rep["findings"]:
            if f["severity"] not in ("high", "medium"):
                continue
            loc = f.get("location") or {}
            out.append({
                "row_id": hashlib.sha256(f"{url}|{f.get('fingerprint','')}".encode()).hexdigest()[:12],
                "url": url,
                "rule": f["ruleId"],
                "severity": f["severity"],
                "label": f.get("label") or "",
                "subject": f.get("subject") or "",
                "file": loc.get("path") or loc.get("file") or "",
                "line": loc.get("line") or "",
                "message": f.get("message", ""),
                "snippet_before": clip(f.get("before")),
                "snippet_after": clip(f.get("after")),
                "verdict_a": "",
                "verdict_b": "",
                "note": "",
            })
    # Shuffle rows so labellers do not see findings grouped by agent; the agent column is left out on purpose.
    rnd.shuffle(out)
    path = os.path.join(DIR, "labels.csv")
    if os.path.exists(path) and "--overwrite" not in args:
        sys.exit(f"{path} exists; pass --overwrite to redraw (this discards any labels in it)")
    cols = ["row_id", "url", "rule", "severity", "label", "subject", "file", "line", "message", "snippet_before", "snippet_after", "verdict_a", "verdict_b", "note"]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(out)
    print(f"label-sheet: {len(drawn)} PRs drawn, {len(out)} high or medium findings -> {path}")


main()
