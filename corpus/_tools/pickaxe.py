#!/usr/bin/env python3
"""Find PRs that introduced a string in given paths. usage: pickaxe.py owner/repo 'string' path [path...]
Uses the commit only mirror; blobs for the given paths are fetched lazily. Prints commit, PR number (from squash message or merge commit), subject."""
import subprocess, sys, os, re
MIRRORS="/tmp/corpus-repos"
repo, needle, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
g=f"{MIRRORS}/{repo.replace('/','-')}.git"
if not os.path.exists(g):
    os.makedirs(g); subprocess.run(["git","init","-q","--bare"],cwd=g)
    subprocess.run(["git","remote","add","origin",f"https://github.com/{repo}"],cwd=g)
    subprocess.run(["git","fetch","-q","--filter=tree:0","origin","HEAD:refs/heads/_default"],cwd=g,check=True)
out=subprocess.run(["git","log","-S",needle,"--diff-filter=AM","--format=%H %s","-n","40","_default","--",*paths],cwd=g,capture_output=True,text=True).stdout
for line in out.splitlines():
    sha,subj=line.split(" ",1)
    m=re.search(r"\(#(\d+)\)\s*$",subj) or re.search(r"#(\d+)",subj)
    pr=m.group(1) if m else ""
    if not pr:
        # find merge commit on first parent chain that has this sha as ancestor via second parent
        mm=subprocess.run(["git","log","--format=%H %P %s","--merges","-n","2000","_default","--ancestry-path",f"{sha}.._default"],cwd=g,capture_output=True,text=True).stdout.splitlines()
        for ml in reversed(mm):
            parts=ml.split(" ",3)
            if len(parts)>3 and re.search(r"#(\d+)",parts[3]) and subprocess.run(["git","merge-base","--is-ancestor",sha,parts[2]],cwd=g).returncode==0:
                pr=re.search(r"#(\d+)",parts[3]).group(1); break
    print(f"{sha[:10]} PR#{pr or '?'} {subj[:90]}")
