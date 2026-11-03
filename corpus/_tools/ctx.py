#!/usr/bin/env python3
"""For each hunk of an entry's diff, print the file and the nearest enclosing test declaration (from the head file, or base when deleted)."""
import re, sys, os
ROOT="/home/claude/testwitness/corpus/entries"
DECL=[r'^\s*(?:async\s+)?def (test\w*)\(', r'^\s*class (\w+)', r'^\s*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?void (\w+)\(', r'^\s*(?:it|test|testWidgets)(?:\.\w+)*\(\s*[\'"`](.+?)[\'"`]', r'^\s*(?:describe|suite|context)(?:\.\w+)*\(\s*[\'"`](.+?)[\'"`]', r'@Test', r'@pytest\.mark\.(skip|xfail)', r'@Disabled|@Ignore']
for slug in sys.argv[1:]:
    d=f"{ROOT}/{slug}"; cur=None; lines={}
    for l in open(f"{d}/pr.diff"):
        if l.startswith("+++ b/"): cur=l[6:].strip(); continue
        if l.startswith("+++ /dev/null"): cur=None; continue
        m=re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)", l)
        if m and cur:
            side,ln="head",int(m.group(2))
            p=f"{d}/files/head/{cur}"
            if not os.path.exists(p): continue
            src=open(p,errors="replace").read().splitlines()
            found=[]
            for i in range(min(ln,len(src))-1,-1,-1):
                for pat in DECL:
                    mm=re.search(pat,src[i])
                    if mm:
                        found.append(src[i].strip()[:100])
                        if 'class ' in pat or 'describe' in pat or len(found)>=3: break
                else: continue
                break
            print(f"{slug} :: {cur}:{ln} :: {' <= '.join(found)}")
