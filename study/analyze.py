#!/usr/bin/env python3
"""Aggregate tables and figures for the launch study.

usage: python3 -I study/analyze.py [--dir study]
Reads results.csv and findings.jsonl, writes tables.md, summary.md and
figures/*.png. Standard library plus matplotlib (no seaborn). Every number is
an aggregate over a cohort; no repository, author or PR is named.
"""
import csv, hashlib, json, math, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = HERE
if "--dir" in sys.argv:
    DIR = os.path.abspath(sys.argv[sys.argv.index("--dir") + 1])
COHORTS = ["claude-code", "copilot", "devin", "cursor", "codex", "human"]
AGENTS = COHORTS[:-1]
LANGS = ["typescript", "python", "java"]
# Reference values from the paper the launch post compares against (strong oracle share per agent; weak or no oracle overall).
PAPER_WEAK_OVERALL = 80.2
PAPER_STRONG = {"claude-code": 67.0, "codex": 18.0}
Z = 1.959964


def wilson(k, n):
    if n == 0:
        return (float("nan"), float("nan"), float("nan"))
    p = k / n
    den = 1 + Z * Z / n
    centre = (p + Z * Z / (2 * n)) / den
    half = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / den
    return (p, max(0.0, centre - half), min(1.0, centre + half))


def newcombe(k1, n1, k2, n2):
    """Difference p1 - p2 with the Newcombe hybrid score interval (method 10)."""
    if n1 == 0 or n2 == 0:
        return (float("nan"),) * 3
    p1, l1, u1 = wilson(k1, n1)
    p2, l2, u2 = wilson(k2, n2)
    d = p1 - p2
    return (d, d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2))


def pct(x):
    return "n/a" if x != x else f"{100 * x:.1f}"


def fmt(k, n):
    p, lo, hi = wilson(k, n)
    return "0/0" if n == 0 else f"{k}/{n} ({pct(p)}%, {pct(lo)} to {pct(hi)})"


def load():
    rows = []
    with open(os.path.join(DIR, "results.csv")) as fh:
        for r in csv.DictReader(fh):
            if r["error"]:
                continue
            r["pr"] = hashlib.sha256(r["url"].encode()).hexdigest()[:16]
            r["fired"] = collections.defaultdict(lambda: collections.Counter())
            r["any_high"] = r["any_high"] == "True" or r["any_high"] == "true"
            r["any_medium"] = r["any_medium"] == "True" or r["any_medium"] == "true"
            for k in ("stars", "changed_lines", "test_files", "new_tests", "new_tests_evaluable"):
                r[k] = int(r[k] or 0)
            rows.append(r)
    errors = 0
    with open(os.path.join(DIR, "results.csv")) as fh:
        errors = sum(1 for r in csv.DictReader(fh) if r["error"])
    findings = []
    fp = os.path.join(DIR, "findings.jsonl")
    if os.path.exists(fp):
        findings = [json.loads(l) for l in open(fp) if l.strip()]
    # Per PR rule counts come from findings.jsonl so artefacts of diff only mode can be left out:
    # V005 (no test results attached) fires on every PR, and V004 with label unreadable means a claim
    # could not be checked for the same reason. Both stay in the findings table at the end.
    by_pr = {r["pr"]: r for r in rows}
    for f in findings:
        if is_artefact(f) or f["pr"] not in by_pr:
            continue
        by_pr[f["pr"]]["fired"][f["rule"]][f["severity"]] += 1
    return rows, findings, errors


def is_artefact(f):
    return f["rule"] == "V005" or (f["rule"] == "V004" and f.get("label") == "unreadable")


def main():
    rows, findings, errors = load()
    by = collections.defaultdict(list)
    for r in rows:
        by[(r["agent"], r["language"])].append(r)
        by[(r["agent"], "all")].append(r)
    rules = sorted({rule for r in rows for rule in r["fired"]})
    out = ["# Launch study tables", "", f"PRs analysed: {len(rows)}. Engine errors excluded: {errors}. Intervals are Wilson 95 percent score intervals. Diff only mode (no test run evidence), default configuration. Rule prevalence leaves out V005 and V004 with label unreadable, which only say that no test results were attached; they are still counted in the last table.", ""]

    # Cell counts
    out += ["## Cell counts (PRs)", "", "| Cohort | " + " | ".join(LANGS) + " | All |", "|---|" + "---|" * (len(LANGS) + 1)]
    for c in COHORTS:
        out.append(f"| {c} | " + " | ".join(str(len(by[(c, l)])) for l in LANGS) + f" | {len(by[(c, 'all')])} |")
    out.append("")

    # Any high / any medium or high
    out += ["## PRs with at least one high finding", "", "| Cohort | Any high | Any medium or high | Difference in any high versus human (percentage points, Newcombe 95 percent) |", "|---|---|---|---|"]
    h = by[("human", "all")]
    hk = sum(r["any_high"] for r in h)
    summary_high = {}
    for c in COHORTS:
        rs = by[(c, "all")]
        k = sum(r["any_high"] for r in rs)
        km = sum(r["any_high"] or r["any_medium"] for r in rs)
        summary_high[c] = (k, len(rs))
        diff = "" if c == "human" else (lambda d: "n/a" if d[0] != d[0] else f"{100*d[0]:+.1f} ({100*d[1]:+.1f} to {100*d[2]:+.1f})")(newcombe(k, len(rs), hk, len(h)))
        out.append(f"| {c} | {fmt(k, len(rs))} | {fmt(km, len(rs))} | {diff} |")
    out.append("")
    out += ["### Any high finding by language", "", "| Cohort | " + " | ".join(LANGS) + " |", "|---|" + "---|" * len(LANGS)]
    for c in COHORTS:
        out.append(f"| {c} | " + " | ".join(fmt(sum(r["any_high"] for r in by[(c, l)]), len(by[(c, l)])) for l in LANGS) + " |")
    out.append("")

    # Prevalence per rule per cohort (any severity, and medium or high)
    out += ["## Prevalence per rule (share of PRs where the rule fired at least once, any severity)", "", "| Rule | " + " | ".join(COHORTS) + " |", "|---|" + "---|" * len(COHORTS)]
    prev = {}
    for rule in rules:
        cells = []
        for c in COHORTS:
            rs = by[(c, "all")]
            k = sum(1 for r in rs if rule in r["fired"])
            prev[(rule, c)] = wilson(k, len(rs))[0] if rs else float("nan")
            cells.append(fmt(k, len(rs)))
        out.append(f"| {rule} | " + " | ".join(cells) + " |")
    out.append("")
    out += ["## Prevalence per rule at medium or high severity", "", "| Rule | " + " | ".join(COHORTS) + " |", "|---|" + "---|" * len(COHORTS)]
    for rule in rules:
        cells = []
        for c in COHORTS:
            rs = by[(c, "all")]
            k = sum(1 for r in rs if r["fired"][rule]["high"] + r["fired"][rule]["medium"] > 0)
            cells.append(fmt(k, len(rs)))
        out.append(f"| {rule} | " + " | ".join(cells) + " |")
    out.append("")
    out += ["## Prevalence per rule per cohort per language (any severity)", "", "| Rule | Cohort | " + " | ".join(LANGS) + " |", "|---|---|" + "---|" * len(LANGS)]
    for rule in rules:
        for c in COHORTS:
            out.append(f"| {rule} | {c} | " + " | ".join(fmt(sum(1 for r in by[(c, l)] if rule in r["fired"]), len(by[(c, l)])) for l in LANGS) + " |")
    out.append("")

    # Oracle strength of new tests
    out += [
        "## New tests with no assertion (O001) or a smoke oracle only (O002)",
        "",
        "Unit is the new test, not the PR: O001 plus O002 findings over new tests the rules can judge (non empty, not skipped, not marked xfail, not an override only). Tests are clustered within PRs, so these Wilson intervals are narrower than a cluster aware interval would be. The paper columns use different definitions (its strong oracle share, and 100 minus it) and are shown for orientation only.",
        "",
        "| Cohort | PRs with new tests | New tests | O001 | O002 | O001 plus O002 share | Strong oracle share (1 minus that) | Paper strong oracle share | Paper weak or no oracle share |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    orate = {}
    for c in COHORTS:
        rs = by[(c, "all")]
        n = sum(r["new_tests_evaluable"] for r in rs)
        o1 = sum(sum(r["fired"]["O001"].values()) for r in rs)
        o2 = sum(sum(r["fired"]["O002"].values()) for r in rs)
        k = min(o1 + o2, n)
        p, lo, hi = wilson(k, n)
        orate[c] = (k, n)
        strong = "n/a" if n == 0 else f"{pct(1-p)}% ({pct(1-hi)} to {pct(1-lo)})"
        ps = PAPER_STRONG.get(c)
        out.append(
            f"| {c} | {sum(1 for r in rs if r['new_tests_evaluable'] > 0)} | {n} | {o1} | {o2} | {fmt(k, n)} | {strong} | {'' if ps is None else f'{ps:.0f}%'} | {'' if ps is None else f'{100-ps:.0f}%'} |"
        )
    k_all = sum(orate[c][0] for c in AGENTS)
    n_all = sum(orate[c][1] for c in AGENTS)
    out.append(f"| all agents | | {n_all} | | | {fmt(k_all, n_all)} | | | {PAPER_WEAK_OVERALL}% |")
    out.append("")

    # Findings by severity and label (from findings.jsonl)
    out += ["## Findings by rule, severity and label (all cohorts)", "", "| Rule | Severity | Label | Findings | Distinct PRs |", "|---|---|---|---|---|"]
    agg = collections.defaultdict(lambda: [0, set()])
    for f in findings:
        key = (f["rule"], f["severity"], f.get("label") or "")
        agg[key][0] += 1
        agg[key][1].add(f["pr"])
    for (rule, sev, label), (n, prs) in sorted(agg.items()):
        out.append(f"| {rule} | {sev} | {label} | {n} | {len(prs)} |")
    out.append("")

    with open(os.path.join(DIR, "tables.md"), "w") as fh:
        fh.write("\n".join(out) + "\n")

    # Summary: numbers only
    s = ["# Launch study summary", "", f"- PRs analysed: {len(rows)} ({', '.join(c + ' ' + str(len(by[(c, 'all')])) for c in COHORTS)})", f"- Engine errors excluded: {errors}"]
    for c in COHORTS:
        k, n = summary_high[c]
        s.append(f"- {c}: any high finding {fmt(k, n)}")
    for c in COHORTS:
        k, n = orate[c]
        s.append(f"- {c}: new tests with no or smoke only oracle {fmt(k, n)}")
    s.append(f"- All agents: new tests with no or smoke only oracle {fmt(k_all, n_all)}; paper reference {PAPER_WEAK_OVERALL}% weak or no oracle")
    s.append("- Full tables: tables.md. Method and limitations: README.md.")
    with open(os.path.join(DIR, "summary.md"), "w") as fh:
        fh.write("\n".join(s) + "\n")

    figures(by, rules, prev, summary_high, orate)
    print(f"analyze: {len(rows)} PRs, {len(rules)} rules fired -> tables.md, summary.md, figures/")


def figures(by, rules, prev, summary_high, orate):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed, figures skipped")
        return
    fdir = os.path.join(DIR, "figures")
    os.makedirs(fdir, exist_ok=True)
    plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
    colour, grey = "#3b6ea8", "#9a9a9a"

    def bars(data, title, fname, ylabel):
        fig, ax = plt.subplots(figsize=(6.4, 3.4))
        xs = list(range(len(COHORTS)))
        ps, errs = [], [[], []]
        for c in COHORTS:
            k, n = data[c]
            p, lo, hi = wilson(k, n)
            p = 0 if p != p else p
            lo = p if lo != lo else lo
            hi = p if hi != hi else hi
            ps.append(100 * p)
            errs[0].append(100 * (p - lo))
            errs[1].append(100 * (hi - p))
        ax.bar(xs, ps, color=[grey if c == "human" else colour for c in COHORTS], yerr=errs, capsize=3, ecolor="#333333", linewidth=0)
        ax.set_xticks(xs, [f"{c}\nn={data[c][1]}" for c in COHORTS])
        ax.set_ylabel(ylabel)
        ax.set_ylim(0, 100)
        ax.set_title(title, loc="left")
        fig.tight_layout()
        fig.savefig(os.path.join(fdir, fname), dpi=150)
        plt.close(fig)

    bars(summary_high, "PRs with at least one high finding (Wilson 95% CI)", "any_high_by_cohort.png", "percent of PRs")
    bars(orate, "New tests with no assertion or a smoke oracle only", "weak_oracle_by_cohort.png", "percent of new tests")

    if rules:
        fig, ax = plt.subplots(figsize=(6.4, 0.32 * len(rules) + 1.4))
        grid = [[100 * (prev[(r, c)] if prev[(r, c)] == prev[(r, c)] else 0) for c in COHORTS] for r in rules]
        im = ax.imshow(grid, cmap="Blues", vmin=0, vmax=max(1, max(max(g) for g in grid)), aspect="auto")
        ax.set_xticks(range(len(COHORTS)), COHORTS, rotation=30, ha="right")
        ax.set_yticks(range(len(rules)), rules)
        for i, row in enumerate(grid):
            for j, v in enumerate(row):
                ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=7, color="white" if v > 0.6 * im.get_clim()[1] else "black")
        ax.set_title("Share of PRs where each rule fired (percent, any severity)", loc="left")
        fig.colorbar(im, ax=ax, fraction=0.04)
        fig.tight_layout()
        fig.savefig(os.path.join(fdir, "rule_prevalence_heatmap.png"), dpi=150)
        plt.close(fig)


main()
