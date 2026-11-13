import type { ChangedFile, Finding, Rule } from '../types.js';
import { makeFinding } from './util.js';

const RULE_SINCE = '0.1.0';

/** Files whose added lines may carry a test command. */
export function isCommandFile(f: ChangedFile): boolean {
  if (f.kind === 'ci-workflow') return true;
  const base = f.path.split('/').pop() ?? f.path;
  return (
    f.kind === 'runner-config' ||
    /^(Makefile|Jenkinsfile|tox\.ini|noxfile\.py|package\.json|pom\.xml|build\.gradle(\.kts)?|\.gitlab-ci\.yml|azure-pipelines\.yml|bitbucket-pipelines\.yml|Taskfile\.ya?ml|justfile)$/.test(base) ||
    /\.(sh|bash|zsh)$/.test(base) ||
    /\.gradle(\.kts)?$/.test(base) ||
    f.path.startsWith('.circleci/') ||
    f.path.startsWith('scripts/')
  );
}

export const TEST_COMMAND =
  /(?:^|[\s;&|("'`])(npm\s+(run\s+)?(test|t)\b|yarn\s+(run\s+)?test\b|pnpm\s+(run\s+)?test\b|bun\s+test\b|npx\s+(jest|vitest|playwright|mocha|ava|tap|jasmine|cypress)\b|\bjest(?![\w-])|\bvitest(?![\w-])|playwright\s+test\b|\bmocha(?![\w-])|\bpytest(?![\w-])|python3?\s+-m\s+(pytest|unittest)\b|\bnose2?\b|\btox\b|\bnox\b|mvn[w]?\s+(-[\w.=-]+\s+)*(test|verify|install|package)\b|\.\/gradlew?\s+(-[\w.=-]+\s+)*(test|check|build)\b|\bgradle\s+(-[\w.=-]+\s+)*(test|check|build)\b|make\s+(test|check)\b|go\s+test\b|cargo\s+test\b|dotnet\s+test\b|rspec\b|phpunit\b)/;

export interface Suppressor {
  re: RegExp;
  what: string;
}

/** Suppressors that must sit on the same line (the same pipeline) as the test command. */
export const INLINE_SUPPRESSORS: Suppressor[] = [
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
export const CONFIG_SUPPRESSORS: Suppressor[] = [
  { re: /<testFailureIgnore>\s*true\s*<\/testFailureIgnore>/, what: '<testFailureIgnore>true' },
  { re: /\bignoreFailures\s*(=|:)\s*true\b/, what: 'ignoreFailures = true' },
  { re: /<skipTests>\s*true\s*<\/skipTests>/, what: '<skipTests>true' },
  { re: /<skip>\s*true\s*<\/skip>/, what: '<skip>true' },
  { re: /<maven\.test\.skip>\s*true\s*<\/maven\.test\.skip>/, what: '<maven.test.skip>true' },
  { re: /\btest\s*\{\s*enabled\s*=\s*false/, what: 'test { enabled = false }' },
  // `(?:(?!X)[^}])*X` reaches only the first header of a brace free run, so repeated headers cannot make it quadratic.
  { re: /(?:^|\})(?:(?!\btasks\.(?:test|withType<Test>)\s*\{)[^}])*\btasks\.(test|withType<Test>)\s*\{[^}]*enabled\s*=\s*false/, what: 'test task disabled' },
];

/** Quoted strings are not commands: `echo "run pytest now"` is not a test run. */
export function stripQuoted(line: string): string {
  // A scanner, not /"(?:\\.|[^"\\])*"|.../g: that regex rescans to the end of the line from every unclosed quote,
  // quadratic on a hostile line (5 s for 100 kB). Same result: once a quote of one kind has no closing quote, no later
  // quote of that kind has one either, so it is not searched again.
  let out = '';
  const unclosed = new Set<string>();
  for (let i = 0; i < line.length; i++) {
    const q = line[i]!;
    if ((q === '"' || q === "'") && !unclosed.has(q)) {
      let j = i + 1;
      while (j < line.length && line[j] !== q) j += line[j] === '\\' ? 2 : 1;
      if (j < line.length) {
        out += '""';
        i = j;
        continue;
      }
      unclosed.add(q);
    }
    out += q;
  }
  return out;
}

function isTestCommandLine(line: string): boolean {
  if (/^\s*(echo|printf|#)/.test(line)) return false;
  return TEST_COMMAND.test(stripQuoted(line));
}

export function stripYamlAndJson(line: string): string {
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
          const isTest = isTestCommandLine(line);
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

export const SNAPSHOT_UPDATE: Suppressor[] = [
  // The `(?:^|[|&;])(?:(?!\bX\b)[^|&;])*` prefix makes each pattern start only at the first command word of a
  // pipeline segment: equivalent, and linear on a line that repeats the command word (it was quadratic).
  { re: /(?:^|[|&;])(?:(?!\b(?:jest|vitest)\b)[^|&;])*\b(jest|vitest)\b[^|&;]*\s(-u|--updateSnapshot|--update)\b/, what: '-u' },
  { re: /(?:^|[|&;])(?:(?!\bjest\b)[^|&;])*\bjest\b[^|&;]*--ci=false\b/, what: '--ci=false' },
  { re: /\bUPDATE_SNAPSHOTS?=1\b/, what: 'UPDATE_SNAPSHOTS=1' },
  { re: /\bSNAPSHOT_UPDATE=1\b/, what: 'SNAPSHOT_UPDATE=1' },
  { re: /\bUPDATE_EXPECT=1\b/, what: 'UPDATE_EXPECT=1' },
  { re: /(?:^|[|&;])(?:(?!\bpytest\b)[^|&;])*\bpytest\b[^|&;]*--snapshot-update\b/, what: '--snapshot-update' },
  { re: /(?:^|[|&;])(?:(?!\bpytest\b)[^|&;])*\bpytest\b[^|&;]*--force-regen\b/, what: '--force-regen' },
  { re: /(?:^|[|&;])(?:(?!\bplaywright\s+test\b)[^|&;])*\bplaywright\s+test\b[^|&;]*--update-snapshots\b/, what: '--update-snapshots' },
  { re: /--approve\b/, what: '--approve' },
  { re: /\bupdateSnapshot\s*:\s*['"]?(all|new)['"]?/, what: 'updateSnapshot: all' },
  { re: /(?:^|\})(?:(?!\bsnapshots?\s*:\s*\{)[^}])*\bsnapshot(s)?\s*:\s*\{[^}]*\bupdate\s*:\s*true/, what: 'snapshot update: true' },
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



/** A workflow line that marks a step as running tests: a run or command line with a test command, or a step name that says so. */
function isTestStepLine(l: string): boolean {
  if (/^\s*(-\s+)?(run|command):/.test(l) && isTestCommandLine(stripYamlAndJson(l))) return true;
  // `name:.*`, not `name:\s*.*`: the overlapping quantifiers were quadratic on a long run of spaces (10 s for 100 kB).
  return /^\s*(-\s+)?name:.*\b(unit tests?|tests?|specs?|e2e|integration tests?|verify)\b/i.test(l) && !/\b(lint|upload|download|build only|coverage upload)\b/i.test(l);
}

/** W002 continue-on-error added to a test step or job. */
export const W002: Rule = {
  id: 'W002',
  name: 'continue-on-error added to a test step or job',
  group: 'W',
  defaultSeverity: 'high',
  since: '0.1.0',
  languages: 'any',
  needs: ['diff', 'workflow'],
  docs: {
    summary: 'A GitHub Actions workflow gained continue-on-error: true on a step whose run command is a test command, or on a job that runs one. The job stays green when the tests fail.',
    falsePositives: 'continue-on-error on a non test step (uploads, linters, optional checks) is not reported. The step is found by scanning the head file for the nearest run: line after the added key in the same step, and the job by the job that contains a test command.',
    example: '       - name: Unit tests\n+        continue-on-error: true\n         run: ./gradlew test',
  },
  async run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.files) {
      if (f.kind !== 'ci-workflow' || f.status === 'deleted' || f.binary) continue;
      if (!/\.github\/workflows\//.test(f.path)) continue;
      const removed = new Set(f.hunks.flatMap((h) => h.removed.map((l) => l.trim())));
      const head = (await ctx.readHead(f.path)) ?? '';
      const lines = head.split('\n');
      for (const h of f.hunks) {
        h.added.forEach((raw, i) => {
          if (!/^\s*(-\s+)?continue-on-error:\s*true\b/.test(raw)) return;
          if (removed.has(raw.trim())) return;
          const lineNo = h.headStart + i;
          const indent = raw.match(/^\s*/)![0].length + (/^\s*-\s/.test(raw) ? 2 : 0);
          // Walk the enclosing block (same indent, until a line with less indent that is not a list continuation) for a test command.
          let testLine: string | undefined;
          for (const dir of [1, -1]) {
            for (let k = lineNo - 1 + dir; k >= 0 && k < lines.length; k += dir) {
              const l = lines[k]!;
              if (!l.trim()) continue;
              const ind = l.match(/^\s*/)![0].length;
              if (ind < indent && !/^\s*-\s/.test(l)) break;
              if (ind < indent - 2) break;
              if (isTestStepLine(l)) {
                testLine = l.trim().replace(/^-\s+/, '');
                break;
              }
              if (dir === -1 && /^\s*-\s/.test(l) && ind <= indent - 2) break;
            }
            if (testLine) break;
          }
          if (!testLine) {
            // Job level: any test command in the job block below.
            const jobIndent = indent;
            for (let k = lineNo; k < lines.length; k++) {
              const l = lines[k]!;
              if (!l.trim()) continue;
              const ind = l.match(/^\s*/)![0].length;
              if (ind < jobIndent) break;
              if (isTestStepLine(l)) {
                testLine = l.trim().replace(/^-\s+/, '');
                break;
              }
            }
          }
          if (!testLine) return;
          out.push(makeFinding(ctx, 'W002', 'high', f, testLine.slice(0, 80), `${f.path} sets continue-on-error on a test step or job (${testLine.slice(0, 60)})`, { line: lineNo, after: raw.trim(), snippet: `coe|${testLine}` }));
        });
      }
    }
    return out;
  },
};

/** W006 The integrity gate itself weakened. */
export const W006: Rule = {
  id: 'W006',
  name: 'The integrity gate itself weakened',
  group: 'W',
  defaultSeverity: 'high',
  since: '0.1.0',
  languages: 'any',
  needs: ['diff'],
  docs: {
    summary: 'The PR changes .testwitness.yml or the workflow step that runs testwitness (its version, inputs, mode or fail_on). Configuration is read from the base ref, so the change takes effect only after merge; this finding makes sure a maintainer sees it. It cannot be acknowledged by the PR author or by the label.',
    falsePositives: 'Legitimate configuration changes. A maintainer acknowledges them with the comment command, and the change applies after merge.',
    example: ' rules:\n-  R003: high\n+  R003: off',
  },
  async run(ctx) {
    const out: Finding[] = [];
    for (const f of ctx.files) {
      const base = f.path.split('/').pop() ?? f.path;
      if (base === '.testwitness.yml') {
        out.push(makeFinding(ctx, 'W006', 'high', f, f.path, `${f.path} was ${f.status}; configuration changes apply after merge and need a maintainer acknowledgement`, { snippet: f.status, label: 'maintainer only' }));
        continue;
      }
      if (f.kind !== 'ci-workflow') continue;
      const inHunks = f.hunks.some((h) => [...h.added, ...h.removed].some((l) => /testwitness/i.test(l)));
      const inFile = inHunks || /uses:\s*\S*testwitness/i.test((await ctx.readHead(f.path)) ?? '') || /uses:\s*\S*testwitness/i.test((await ctx.readBase(f.oldPath ?? f.path)) ?? '');
      if (!inFile) continue;
      out.push(makeFinding(ctx, 'W006', 'high', f, f.path, `${f.path} changes the testwitness workflow step`, { snippet: 'workflow', label: 'maintainer only' }));
    }
    return out;
  },
};

export function rulesW(): Rule[] {
  return [W002, W003, W006, S004];
}
