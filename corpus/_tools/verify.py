#!/usr/bin/env python3
"""Verify every corpus entry, rebuild index.json, print counts."""
import json, os, sys, hashlib, collections
ROOT = "/home/claude/testwitness/corpus"
E = f"{ROOT}/entries"
ALLOWED = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
KEYS = ["url","repo","number","title","merged_at","stars","license","language","category","split","base_sha","head_sha","files_changed","additions","deletions"]
errors = []; index = []
for slug in sorted(os.listdir(E)):
    d = f"{E}/{slug}"
    for f in ("pr.json","pr.diff","expected.json","NOTES.md"):
        if not os.path.isfile(f"{d}/{f}"): errors.append(f"{slug}: missing {f}")
    if os.path.getsize(f"{d}/pr.diff") == 0 if os.path.isfile(f"{d}/pr.diff") else True: errors.append(f"{slug}: empty pr.diff")
    try:
        p = json.load(open(f"{d}/pr.json"))
        for k in KEYS:
            if k not in p: errors.append(f"{slug}: pr.json missing {k}")
        if p.get("stars",0) < 100: errors.append(f"{slug}: under 100 stars")
        if p.get("license") not in ALLOWED: errors.append(f"{slug}: licence {p.get('license')}")
        if p.get("additions",0)+p.get("deletions",0) > 2000: errors.append(f"{slug}: over 2000 lines")
        want = "tuning" if int(hashlib.sha256(p["url"].encode()).hexdigest(),16) % 2 == 0 else "heldout"
        if p.get("split") != want: errors.append(f"{slug}: split should be {want}")
        index.append(p)
    except Exception as ex: errors.append(f"{slug}: bad pr.json {ex}")
    try:
        exp = json.load(open(f"{d}/expected.json"))
        assert isinstance(exp, list)
        for f in exp: assert f["verdict"] in ("tp","fp") and f["ruleId"]
    except Exception as ex: errors.append(f"{slug}: bad expected.json {ex}")
with open(f"{ROOT}/index.json","w") as fh: json.dump(index, fh, indent=2); fh.write("\n")
json.load(open(f"{ROOT}/index.json"))
print("entries:", len(index))
print("categories:", dict(sorted(collections.Counter(p["category"] for p in index).items())))
print("split:", dict(collections.Counter(p["split"] for p in index)))
print("split by category:", {c: dict(collections.Counter(p["split"] for p in index if p["category"]==c)) for c in sorted({p["category"] for p in index})})
print("languages:", dict(collections.Counter(p["language"] for p in index)))
print("licences:", dict(collections.Counter(p["license"] for p in index)))
print("errors:", len(errors))
for e in errors: print("  ", e)
sys.exit(1 if errors else 0)
