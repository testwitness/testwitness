#!/usr/bin/env python3
"""Agreement and precision from the filled label sheet.

usage: python3 -I study/kappa.py [--dir study]
Reads labels.csv (verdict_a, verdict_b in {tp, fp, unsure}). Prints and writes
precision.md: Cohen's kappa overall and per rule over rows both labellers
filled, and per rule precision over rows where both labellers agree on tp or
fp (disagreements and unsure rows are counted and listed as unresolved, never
silently dropped). Precision intervals are Wilson 95 percent.
"""
import csv, math, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
DIR = os.path.abspath(args[args.index("--dir") + 1]) if "--dir" in args else HERE
CATS = ["tp", "fp", "unsure"]
Z = 1.959964


def wilson(k, n):
    if n == 0:
        return (float("nan"),) * 3
    p = k / n
    den = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / den
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / den
    return p, max(0.0, c - h), min(1.0, c + h)


def kappa(pairs):
    n = len(pairs)
    if n == 0:
        return float("nan")
    po = sum(a == b for a, b in pairs) / n
    ca = collections.Counter(a for a, _ in pairs)
    cb = collections.Counter(b for _, b in pairs)
    pe = sum(ca[c] * cb[c] for c in CATS) / (n * n)
    return float("nan") if pe == 1 else (po - pe) / (1 - pe)


def norm(v):
    v = (v or "").strip().lower()
    return v if v in CATS else None


def f(x, d=2):
    return "n/a" if x != x else f"{x:.{d}f}"


def main():
    with open(os.path.join(DIR, "labels.csv")) as fh:
        rows = list(csv.DictReader(fh))
    filled = [(r, norm(r["verdict_a"]), norm(r["verdict_b"])) for r in rows]
    both = [(r, a, b) for r, a, b in filled if a and b]
    out = ["# Label agreement and precision", "", f"Rows: {len(rows)}. Rows labelled by both: {len(both)}. Kappa is Cohen's kappa over the three categories tp, fp, unsure.", ""]
    out.append(f"Overall kappa: {f(kappa([(a, b) for _, a, b in both]))}")
    out += ["", "| Rule | Rows | Both labelled | Kappa | Agreed tp | Agreed fp | Unresolved | Precision (Wilson 95 percent) |", "|---|---|---|---|---|---|---|---|"]
    per = collections.defaultdict(list)
    for r, a, b in filled:
        per[r["rule"]].append((r, a, b))
    for rule in sorted(per):
        items = per[rule]
        bl = [(a, b) for _, a, b in items if a and b]
        tp = sum(1 for a, b in bl if a == b == "tp")
        fp = sum(1 for a, b in bl if a == b == "fp")
        unresolved = len(bl) - tp - fp
        p, lo, hi = wilson(tp, tp + fp)
        prec = "n/a" if tp + fp == 0 else f"{f(p)} ({f(lo)} to {f(hi)})"
        out.append(f"| {rule} | {len(items)} | {len(bl)} | {f(kappa(bl))} | {tp} | {fp} | {unresolved} | {prec} |")
    tp = sum(1 for _, a, b in both if a == b == "tp")
    fp = sum(1 for _, a, b in both if a == b == "fp")
    p, lo, hi = wilson(tp, tp + fp)
    out.append(f"| all | {len(rows)} | {len(both)} | {f(kappa([(a, b) for _, a, b in both]))} | {tp} | {fp} | {len(both) - tp - fp} | {'n/a' if tp + fp == 0 else f'{f(p)} ({f(lo)} to {f(hi)})'} |")
    dis = [r["row_id"] for r, a, b in both if a != b or a == "unsure"]
    out += ["", f"Unresolved row ids (resolve by discussion, then rerun): {', '.join(dis) if dis else 'none'}"]
    text = "\n".join(out) + "\n"
    with open(os.path.join(DIR, "precision.md"), "w") as fh:
        fh.write(text)
    print(text)


main()
