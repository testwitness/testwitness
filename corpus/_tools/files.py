#!/usr/bin/env python3
"""Populate entries/<slug>/files/{base,head}/<path> and files/manifest.json from the git mirrors.
Copies every changed test file, snapshot, runner config and CI workflow (any size) and changed
production source files under 50 KB. Globs mirror packages/core/src/diff/classify.ts."""
import json, os, re, subprocess, sys, shutil
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "entries")
MIRRORS = "/tmp/corpus-repos"
TEST = ['**/*Test.java','**/*Tests.java','**/*IT.java','**/*TestCase.java','**/src/test/**/*.java','**/src/test/**/*.kt',
 '**/*.test.{ts,tsx,js,jsx,mts,cts,mjs,cjs}','**/*.spec.{ts,tsx,js,jsx,mts,cts,mjs,cjs}','**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
 '**/test/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}','**/tests/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}','**/e2e/**/*.{ts,js}',
 '**/test_*.py','**/*_test.py','**/tests/**/*.py','**/test/**/*.py']
SNAP = ['**/__snapshots__/**','**/*.snap','**/*.approved.*','**/*.received.*','**/*.verified.*','**/*.golden','**/testdata/**/*.golden',
 '**/__screenshots__/**','**/*-snapshots/**','**/snapshots/**','**/__snapshots__/**/*.ambr','**/expected/**']
RUNNER = ['**/jest.config.{js,cjs,mjs,ts,cts,mts,json}','**/vitest.config.{js,cjs,mjs,ts,cts,mts}','**/vitest.workspace.{js,ts}','**/vite.config.{js,ts,mjs,mts}',
 '**/playwright.config.{js,ts,mjs,mts}','**/.mocharc.{js,cjs,yml,yaml,json,jsonc}','**/package.json','**/pytest.ini','**/pyproject.toml','**/setup.cfg','**/tox.ini',
 '**/noxfile.py','**/conftest.py','**/pom.xml','**/build.gradle','**/build.gradle.kts','**/settings.gradle','**/settings.gradle.kts','**/gradle.properties',
 '**/junit-platform.properties','**/testng.xml','**/testng*.xml','**/Makefile','**/.testwitness.yml',
 # coverage configs (COVERAGE_CONFIG_FILES in classify.ts), read by C002
 '**/.coveragerc','**/codecov.yml','**/.codecov.yml','**/.coveralls.yml','**/.nycrc','**/.nycrc.json','**/.nycrc.{yml,yaml}',
 '**/codecov.yaml','**/.codecov.yaml','**/sonar-project.properties','**/stryker.config.{js,mjs,json}','**/stryker.conf.{js,json}']
WORKFLOW = ['.github/workflows/*.{yml,yaml}','**/.gitlab-ci.yml','**/.gitlab/**/*.yml','**/Jenkinsfile','**/azure-pipelines.yml','**/.circleci/config.yml','**/bitbucket-pipelines.yml']
CODE_EXT = ('.py','.java','.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts','.kt','.scala','.groovy','.rs','.go','.cs','.vue','.svelte')
def expand(g):
    m = re.search(r'\{([^}]*)\}', g)
    if not m: return [g]
    out = []
    for alt in m.group(1).split(','): out += expand(g[:m.start()] + alt + g[m.end():])
    return out
def to_re(g):
    r = ''; i = 0
    while i < len(g):
        if g.startswith('**/', i): r += '(?:.*/)?'; i += 3
        elif g.startswith('**', i): r += '.*'; i += 2
        elif g[i] == '*': r += '[^/]*'; i += 1
        elif g[i] == '?': r += '[^/]'; i += 1
        else: r += re.escape(g[i]); i += 1
    return re.compile('^' + r + '$')
def matcher(globs):
    rs = [to_re(x) for g in globs for x in expand(g)]
    return lambda p: any(r.match(p) for r in rs)
is_test, is_snap, is_runner, is_wf = matcher(TEST), matcher(SNAP), matcher(RUNNER), matcher(WORKFLOW)
def run(cmd, cwd, check=True):
    r = subprocess.run(cmd, capture_output=True, cwd=cwd)
    if check and r.returncode != 0: raise RuntimeError(f"{' '.join(cmd)}: {r.stderr.decode()[:200]}")
    return r.stdout
def mirror(repo, base, head, num):
    g = f"{MIRRORS}/{repo.replace('/','-')}.git"
    if not os.path.exists(g):
        os.makedirs(g); run(["git","init","-q","--bare"], g)
        run(["git","remote","add","origin",f"https://github.com/{repo}"], g)
        run(["git","fetch","-q","--filter=tree:0","origin","HEAD:refs/heads/_default"], g)
        run(["git","fetch","-q","--filter=tree:0","origin",f"refs/pull/{num}/head:refs/pull/{num}/head"], g)
    for sha in (base, head):
        if subprocess.run(["git","cat-file","-e",f"{sha}^{{commit}}"], cwd=g, capture_output=True).returncode != 0:
            run(["git","fetch","-q","--filter=tree:0","origin",sha], g)
    return g
def wanted(path, size):
    if is_test(path) or is_snap(path) or is_runner(path) or is_wf(path): return True
    return path.endswith(CODE_EXT) and size < 50 * 1024
def blob_size(g, sha, path):
    r = subprocess.run(["git","cat-file","-s",f"{sha}:{path}"], cwd=g, capture_output=True)
    return int(r.stdout) if r.returncode == 0 else None
def copy(g, sha, path, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh: fh.write(run(["git","show",f"{sha}:{path}"], g))
def main():
    slugs = sys.argv[1:] or sorted(os.listdir(ROOT))
    for slug in slugs:
        d = f"{ROOT}/{slug}"; p = json.load(open(f"{d}/pr.json"))
        g = mirror(p["repo"], p["base_sha"], p["head_sha"], p["number"])
        fdir = f"{d}/files"; shutil.rmtree(fdir, ignore_errors=True); os.makedirs(fdir)
        ns = run(["git","diff","--name-status","--find-renames",p["base_sha"],p["head_sha"]], g).decode().splitlines()
        manifest = []; copied = 0
        for line in ns:
            parts = line.split("\t"); st = parts[0][0]
            if st == "R": rec = {"path": parts[2], "status": "renamed", "oldPath": parts[1]}
            elif st == "A": rec = {"path": parts[1], "status": "added"}
            elif st == "D": rec = {"path": parts[1], "status": "deleted"}
            else: rec = {"path": parts[1], "status": "modified"}
            manifest.append(rec)
            if rec["status"] != "added":
                old = rec.get("oldPath", rec["path"]); s = blob_size(g, p["base_sha"], old)
                if s is not None and wanted(old, s): copy(g, p["base_sha"], old, f"{fdir}/base/{old}"); copied += 1
            if rec["status"] != "deleted":
                s = blob_size(g, p["head_sha"], rec["path"])
                if s is not None and wanted(rec["path"], s): copy(g, p["head_sha"], rec["path"], f"{fdir}/head/{rec['path']}"); copied += 1
        with open(f"{fdir}/manifest.json","w") as fh: json.dump(manifest, fh, indent=2); fh.write("\n")
        print(f"{slug}: {len(manifest)} changed, {copied} files copied")
main()
