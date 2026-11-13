#!/usr/bin/env python3
"""Write the hand label for one entry (batch 4, collected 2026-11-13).
usage: lab.py <slug> <category> <notes> [expected-json]
expected-json defaults to [] (an honest control). Writes expected.json and NOTES.md, sets category
in pr.json, and appends the label to labels_batch4.jsonl so the batch can be replayed."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(os.path.dirname(HERE), "entries")
slug, cat, notes = sys.argv[1], sys.argv[2], sys.argv[3]
exp = json.loads(sys.argv[4]) if len(sys.argv) > 4 else []
d = f"{ROOT}/{slug}"; assert os.path.isfile(f"{d}/pr.json"), slug
for f in exp:
    assert f["verdict"] in ("tp", "fp") and f.get("severity") in ("low", "medium", "high"), f
p = json.load(open(f"{d}/pr.json")); p["category"] = cat
with open(f"{d}/pr.json", "w") as fh: json.dump(p, fh, indent=2); fh.write("\n")
with open(f"{d}/expected.json", "w") as fh: json.dump(exp, fh, indent=2); fh.write("\n")
with open(f"{d}/NOTES.md", "w") as fh: fh.write(f"# {p['repo']}#{p['number']}\n\n{notes.strip()}\n")
with open(f"{HERE}/labels_batch4.jsonl", "a") as fh: fh.write(json.dumps({"slug": slug, "category": cat, "expected": exp, "notes": notes}) + "\n")
print(f"labelled {slug} [{cat}] {p['split']} findings={len(exp)}")
