import type { ChangedFile, Finding, Rule } from '../types.js';
import { makeFinding } from './util.js';

const RULE_SINCE = '0.1.0';

/** Files whose added lines may carry a test command. */
function isCommandFile(f: ChangedFile): boolean {
  if (f.kind === 'ci-workflow') return true;
  const base = f.path.split('/').pop() ?? f.path;
  return (
    f.kind === 'runner-config' ||
    /^(Makefile|Jenkinsfile|tox\.ini|noxfile\.py|package\.json|pom\.xml|build\.gradle(\.kts)?|\.gitlab-ci\.yml|azure-pipelines\.yml|bitbucket-pipelines\.yml|Taskfile\.ya?ml|justfile)$/.test(base) ||
    /\.(sh|bash|zsh)$/.test(base) ||
    f.path.startsWith('.circleci/') ||
    f.path.startsWith('scripts/')
  );
}

export const TEST_COMMAND =
  /(?:^|[\s;&|("'`])(npm\s+(run\s+)?(test|t)\b|yarn\s+(run\s+)?test\b|pnpm\s+(run\s+)?test\b|bun\s+test\b|npx\s+(jest|vitest|playwright|mocha|ava|tap|jasmine|cypress)\b|\bjest\b|\bvitest\b|playwright\s+test\b|\bmocha\b|\bpytest\b|python3?\s+-m\s+(pytest|unittest)\b|\bnose2?\b|\btox\b|\bnox\b|mvn[w]?\s+(-[\w.=-]+\s+)*(test|verify|install|package)\b|\.\/gradlew?\s+(-[\w.=-]+\s+)*(test|check|build)\b|\bgradle\s+(-[\w.=-]+\s+)*(test|check|build)\b|make\s+(test|check)\b|go\s+test\b|cargo\s+test\b|dotnet\s+test\b|rspec\b|phpunit\b)/;

interface Suppressor {
  re: RegExp;
  what: string;
}

/** Suppressors that must sit on the same line (the same pipeline) as the test command. */
const INLINE_SUPPRESSORS: Suppressor[] = [
  { re: /\|\|\s*true\b/, what: '|| true' },
  { re: /\|\|\s*exit\s+0\b/, what: '|| exit 0' },
  { re: /\|\|\s*:(\s|$)/, what: '|| :' },
  { re: /\|\|\s*echo\b/, what: '|| echo' },
  { re: /;\s*true\s*$/, what: '; true' },
  { re: /;\s*echo\s+[^;|&]*$/, what: '; echo' },
  { re: /2>&1\s*\|\s*(tail|head|grep|cat|tee)\b/, what: 'piped to a filter without pipefail' },
  { re: /-DskipTests\b/, what: '-DskipTests' },
  { re: /-Dmaven\.test\.skip(=true)?\b/, what: '-Dmaven.test.skip' },
  { re: /-DtestFailureIgnore=true\b/, what: '-DtestFailureIgnore=true' },
  { re: /-Dsurefire\.failIfNoSpecifiedTests=false\b/, what: 'failIfNoSpecifiedTests=false' },
  { re: /\s-x\s+test\b/, what: '-x test' },
  { re: /--exitcode\s*[= ]\s*0\b|--exit-code\s*[= ]\s*0\b/, what: '--exitcode 0' },
  { re: /\|\|\s*\$\{?\{?\s*false/, what: '|| false' },
];

/** Suppressors that live on their own line in config. */
const CONFIG_SUPPRESSORS: Suppressor[] = [
  { re: /<testFailureIgnore>\s*true\s*<\/testFailureIgnore>/, what: '<testFailureIgnore>true' },
  { re: /\bignoreFailures\s*(=|:)\s*true\b/, what: 'ignoreFailures = true' },
  { re: /<skipTests>\s*true\s*<\/skipTests>/, what: '<skipTests>true' },
  { re: /<skip>\s*true\s*<\/skip>/, what: '<skip>true' },
  { re: /<maven\.test\.skip>\s*true\s*<\/maven\.test\.skip>/, what: '<maven.test.skip>true' },
  { re: /\btest\s*\{\s*enabled\s*=\s*false/, what: 'test { enabled = false }' },
  { re: /\btasks\.(test|withType<Test>)\s*\{[^}]*enabled\s*=\s*false/, what: 'test task disabled' },
];

function stripYamlAndJson(line: string): string {
  // Lines in workflows and package.json scripts carry a key and quotes; strip to the command.
  return line
    .replace(/^\s*-?\s*(run|script|cmd|command|"test"|test|"[\w:-]+")\s*:\s*/, '')
    .replace(/^\s*"[^"]*"\s*:\s*"/, '')
    .replace(/",?\s*$/, '')
    .replace(/\\"/g, '"');
}

/** W003 Failure suppressed in the run command. */
export const W003: Rule = {
  id: 'W003',
  name: 'Failure suppressed in the run command',
  group: 'W',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'workflow', 'config'],
  docs: {
    summary: 'A test command in a workflow, package.json script, Makefile, tox.ini, Jenkinsfile or build file gained a construct that hides its exit code (|| true, || exit 0, -DskipTests, testFailureIgnore, ignoreFailures, set +e, a pipe to tail without pipefail).',
    falsePositives: '|| true on a non test command in the same script. The suppressor must sit on the same line as the test command, or be a set +e in the same hunk ahead of it. A line that merely moved within the file is not reported.',
    example: '-        run: pytest -q\n+        run: pytest -q || true',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.files) {
      if (f.status === 'deleted' || f.binary || !isCommandFile(f)) continue;
      const removed = new Set(f.hunks.flatMap((h) => h.removed.map((l) => l.trim())));
      for (const h of f.hunks) {
        let setPlusE: number | undefined;
        h.added.forEach((raw, i) => {
          const trimmed = raw.trim();
          if (removed.has(trimmed)) return; // moved, not new
          const line = stripYamlAndJson(raw);
          const lineNo = h.headStart + i;
          if (/^\s*set\s+\+e\b/.test(line)) {
            setPlusE = lineNo;
            return;
          }
          const isTest = TEST_COMMAND.test(line);
          if (isTest) {
            for (const s of INLINE_SUPPRESSORS) {
              if (s.re.test(line)) {
                out.push(makeFinding(ctx, 'W003', 'high', f, trimmed.slice(0, 80), `Test command in ${f.path} suppresses failure with ${s.what}`, { line: lineNo, after: trimmed, snippet: trimmed }));
                return;
              }
            }
            if (setPlusE !== undefined) {
              out.push(makeFinding(ctx, 'W003', 'high', f, trimmed.slice(0, 80), `Test command in ${f.path} runs after set +e, so its failure is ignored`, { line: lineNo, after: trimmed, snippet: `set+e|${trimmed}` }));
              return;
            }
          }
          for (const s of CONFIG_SUPPRESSORS) {
            if (s.re.test(line)) {
              out.push(makeFinding(ctx, 'W003', 'high', f, trimmed.slice(0, 80), `${f.path} disables test failures with ${s.what}`, { line: lineNo, after: trimmed, snippet: trimmed }));
              return;
            }
          }
        });
      }
    }
    return out;
  },
};

const SNAPSHOT_UPDATE: Suppressor[] = [
  { re: /\b(jest|vitest)\b[^|&;]*\s(-u|--updateSnapshot|--update)\b/, what: '-u' },
  { re: /\bjest\b[^|&;]*--ci=false\b/, what: '--ci=false' },
  { re: /\bUPDATE_SNAPSHOTS?=1\b/, what: 'UPDATE_SNAPSHOTS=1' },
  { re: /\bSNAPSHOT_UPDATE=1\b/, what: 'SNAPSHOT_UPDATE=1' },
  { re: /\bUPDATE_EXPECT=1\b/, what: 'UPDATE_EXPECT=1' },
  { re: /\bpytest\b[^|&;]*--snapshot-update\b/, what: '--snapshot-update' },
  { re: /\bpytest\b[^|&;]*--force-regen\b/, what: '--force-regen' },
  { re: /\bplaywright\s+test\b[^|&;]*--update-snapshots\b/, what: '--update-snapshots' },
  { re: /--approve\b/, what: '--approve' },
  { re: /\bupdateSnapshot\s*:\s*['"]?(all|new)['"]?/, what: 'updateSnapshot: all' },
  { re: /\bsnapshot(s)?\s*:\s*\{[^}]*\bupdate\s*:\s*true/, what: 'snapshot update: true' },
  { re: /\bci\s*:\s*false\b/, what: 'ci: false' },
];

/** S004 Snapshot update enabled in the test command. */
export const S004: Rule = {
  id: 'S004',
  name: 'Snapshot update enabled in the test command',
  group: 'S',
  defaultSeverity: 'high',
  since: RULE_SINCE,
  languages: 'any',
  needs: ['diff', 'workflow', 'config'],
  docs: {
    summary: 'The test command or runner config now rewrites snapshots on every run (jest -u, --updateSnapshot, --ci=false, UPDATE_SNAPSHOTS=1, syrupy --snapshot-update, Playwright --update-snapshots, ApprovalTests --approve), so a changed snapshot can never fail.',
    falsePositives: 'A separate, clearly named script such as "test:update" that is not the CI test command. Reported for any script line; acknowledge the update script once.',
    example: '-    "test": "jest --ci",\n+    "test": "jest -u",',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.files) {
      if (f.status === 'deleted' || f.binary || !isCommandFile(f)) continue;
      const removed = new Set(f.hunks.flatMap((h) => h.removed.map((l) => l.trim())));
      for (const h of f.hunks) {
        h.added.forEach((raw, i) => {
          const trimmed = raw.trim();
          if (removed.has(trimmed)) return;
          const line = stripYamlAndJson(raw);
          for (const s of SNAPSHOT_UPDATE) {
            if (s.re.test(line)) {
              out.push(makeFinding(ctx, 'S004', 'high', f, trimmed.slice(0, 80), `${f.path} turns on snapshot updating with ${s.what}`, { line: h.headStart + i, after: trimmed, snippet: trimmed }));
              return;
            }
          }
        });
        // `--ci` removed from a jest command that still runs.
        for (const r of h.removed) {
          const rl = stripYamlAndJson(r);
          if (/\bjest\b/.test(rl) && /\s--ci\b/.test(rl)) {
            const replacement = h.added.map(stripYamlAndJson).find((a) => /\bjest\b/.test(a) && !/\s--ci\b/.test(a));
            if (replacement) {
              out.push(makeFinding(ctx, 'S004', 'medium', f, replacement.trim().slice(0, 80), `${f.path} dropped --ci from the jest command, so missing snapshots are written instead of failing`, { line: h.headStart, before: r.trim(), after: replacement.trim(), snippet: `noci|${replacement.trim()}` }));
            }
          }
        }
      }
    }
    return out;
  },
};

export function rulesW(): Rule[] {
  return [W003, S004];
}
