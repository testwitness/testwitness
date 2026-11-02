#!/usr/bin/env python3
"""Rewrite expected.json for every entry with the real rule catalogue ids."""
import json, os, re
ROOT = "/home/claude/testwitness/corpus/entries"
PAT = [r'^\s*(?:async\s+)?def (test_\w+)\(', r'^\s*(?:public\s+)?void (\w+)\(', r'^\s*(?:it|test)(?:\.each\([^)]*\))?\(\s*[\'"`](.+?)[\'"`]']
def gone_names(slug):
    rem, add = set(), set()
    for l in open(f"{ROOT}/{slug}/pr.diff").read().splitlines():
        if l.startswith(('+++','---')): continue
        for p in PAT:
            m = re.match(p, l[1:])
            if m: (rem if l.startswith('-') else add if l.startswith('+') else set()).add(m.group(1))
    return sorted(rem - add)
def low(rule, label, subject=None):
    f = {"ruleId": rule, "severity": "low", "label": label, "verdict": "fp"}
    if subject: f["subject"] = subject
    return f
E = {}
for slug in sorted(os.listdir(ROOT)):
    cat = json.load(open(f"{ROOT}/{slug}/pr.json"))["category"]
    if cat == "move": E[slug] = [low("R001", "moved", n) for n in gone_names(slug)]
    elif cat == "parametrize": E[slug] = [low("R001", "parameterised", n) for n in gone_names(slug)]
    else: E[slug] = []
# skips: conditional, low
E["tox-dev-tox-4078"] = [low("R003","conditional",n) for n in ("test_build_wheel_in_non_base_pkg_env","test_build_wheel_in_free_threaded_pkg_env","test_build_wheel_in_debug_pkg_env")]
E["pandas-dev-pandas-40233"] = [low("R003","conditional",n) for n in ("test_bs4_version_fails","test_same_ordering")]
E["pandas-dev-pandas-69986"] = [low("R003","conditional","test_encoding_detected")]
E["vitejs-vite-15096"] = [low("R003","conditional","full-reload encodeURI path"), low("R003","conditional","Unicode path")]
E["jestjs-jest-9966"] = [low("R003","conditional","e2e/__tests__/watchModeNoAccess.test.ts")]
E["eslint-eslint-19503"] = []
# true positives
def tp(rule, sev, subject, reason, label=None):
    f = {"ruleId": rule, "severity": sev, "subject": subject, "verdict": "tp", "reason": reason}
    if label: f["label"] = label
    return f
E["trpc-trpc-1709"] = [tp("R003","medium","$subscription() - server randomly stop and restart (this test might be flaky, try re-running)","test changed to test.skip with only a flaky remark, no issue or condition")]
E["excalidraw-excalidraw-7213"] = [tp("R003","medium","should bump the version of a labeled arrow when the label is updated","it changed to it.skip with a FIXME comment and no issue reference")]
E["netty-netty-14828"] = [tp("R003","medium","SingleThreadIoEventLoopTest#testSuspendingWhileRegistrationActive","@Disabled added with a free text flaky reason and no tracking issue")]
E["quarkusio-quarkus-55429"] = [tp("R003","medium","AccessLogTestCase","class level @Disabled with a flaky remark and no tracking issue, covers every test in the class")]
E["pandas-dev-pandas-25894"] = [tp("R004","high","TestTSPlot::test_time_change_xlim","assertions moved into a new test marked xfail(strict=False, reason='Unreliable test'), so they can never fail")]
for slug, exp in E.items():
    with open(f"{ROOT}/{slug}/expected.json","w") as fh: json.dump(exp, fh, indent=2); fh.write("\n")
    print(slug, len(exp))
