/**
 * The mutation plan behind `testwitness mutate-plan`: which production files a PR changed, and the per tool settings
 * that mutate only those files (StrykerJS for TypeScript and JavaScript, PIT for Java). It reads git and nothing else;
 * it never runs a mutation tool or the repository's code. The opt in mutation job (docs/mutation-on-request.md) runs
 * the tool with these settings and hands its report back to testwitness through the mutation input.
 *
 * Paths and class names come from the pull request, so they are untrusted. Anything outside a conservative character
 * set (letters, digits, `_ . / @ + -`) is left out of the plan with a note, so the shell lines never need escaping
 * beyond single quotes and a comma separated list can never be split by a file name.
 */
import picomatch from 'picomatch';
import type { ChangedFile, LanguageId, ResolvedConfig } from '../types.js';
import { listTree, mergeBase, rawDiff, revParse, showFile } from '../git.js';
import { parseUnifiedDiff } from '../diff/parse.js';
import { classifyFiles, classifyPath } from '../diff/classify.js';
import { stem } from '../rules/util.js';

export const MUTATION_PLAN_MAX_FILES = 200;

export interface MutationPlanFile {
  path: string;
  language: LanguageId;
  /** Inclusive line ranges of the head file that the PR added or changed. */
  ranges: Array<[number, number]>;
  /** Tool that would mutate the file: stryker, pit, or none (Python: mutmut reports carry no lines testwitness can read). */
  tool: 'stryker' | 'pit' | 'none';
  /** Java only: the class name PIT mutates. */
  className?: string;
  /** Java only: test classes found for it by name. */
  testClasses?: string[];
}

export interface MutationPlan {
  base: string;
  head: string;
  files: MutationPlanFile[];
  stryker: {
    /** `--mutate` entries: a file with a line range, `src/cart.ts:3-9`. */
    mutate: string[];
    /** Arguments to `npx stryker` (the command `stryker run` with these flags). */
    args: string[];
    report: string;
  };
  pit: {
    targetClasses: string[];
    targetTests: string[];
    /** Arguments to `mvn`. */
    args: string[];
    report: string;
  };
  notes: string[];
}

const SAFE = /^[A-Za-z0-9_./@+-]+$/;

function ranges(lines: Set<number>): Array<[number, number]> {
  const sorted = [...lines].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && l === last[1] + 1) last[1] = l;
    else out.push([l, l]);
  }
  return out;
}

/** Fully qualified Java class name: the package declaration of the source when it has one, else the path below a java source root. */
export function javaClassName(path: string, source: string | undefined): string | undefined {
  const simple = (path.split('/').pop() ?? '').replace(/\.java$/, '');
  if (!simple) return undefined;
  const pkg = source ? /^\s*package\s+([\w.]+)\s*;/m.exec(source.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] : undefined;
  if (pkg) return `${pkg}.${simple}`;
  const m = /(?:^|\/)src\/(?:main|test)\/java\/(.+)\.java$/.exec(path);
  return m ? m[1]!.replace(/\//g, '.') : simple;
}

export interface MutationPlanOptions {
  cwd: string;
  base: string;
  head: string;
  config: ResolvedConfig;
  /** Base is a commit already (no merge base). */
  resolved?: boolean;
}

export async function planMutation(opts: MutationPlanOptions): Promise<MutationPlan> {
  const git = { cwd: opts.cwd };
  const headSha = await revParse(opts.head, git);
  const baseSha = opts.resolved ? await revParse(opts.base, git) : await mergeBase(opts.base, headSha, git);
  const files = parseUnifiedDiff(await rawDiff(baseSha, headSha, git));
  const classify = { testGlobs: opts.config.paths.tests, ignoreGlobs: opts.config.paths.ignore };
  const sources = new Map<string, string | undefined>();
  for (const f of files) {
    if (f.status === 'deleted') continue;
    const c = classifyPath(f.path, undefined, classify);
    if (c.language && c.kind === 'production') sources.set(f.path, await showFile(headSha, f.path, git));
  }
  classifyFiles(files, (f) => sources.get(f.path), classify);
  const notes: string[] = [];
  const production = files.filter((f): f is ChangedFile & { language: LanguageId } => f.kind === 'production' && f.status !== 'deleted' && !f.binary && !!f.language);
  if (production.length > MUTATION_PLAN_MAX_FILES) notes.push(`${production.length} changed production files; the plan keeps the first ${MUTATION_PLAN_MAX_FILES}.`);

  let testFiles: string[] | undefined;
  const ignore = picomatch(opts.config.paths.ignore, { dot: true });
  const javaTests = async (): Promise<string[]> => {
    testFiles ??= (await listTree(headSha, git)).filter((p) => p.endsWith('.java') && !ignore(p) && classifyPath(p, undefined, classify).kind === 'test');
    return testFiles;
  };

  const planned: MutationPlanFile[] = [];
  for (const f of production.slice(0, MUTATION_PLAN_MAX_FILES)) {
    if (!SAFE.test(f.path)) {
      notes.push(`Left out ${JSON.stringify(f.path)}: the path has characters the plan does not pass to a shell.`);
      continue;
    }
    const r = ranges(f.addedLines);
    if (!r.length) continue; // only deletions: nothing to mutate
    if (f.language === 'typescript' || f.language === 'javascript') {
      planned.push({ path: f.path, language: f.language, ranges: r, tool: 'stryker' });
    } else if (f.language === 'java') {
      const className = javaClassName(f.path, sources.get(f.path));
      if (!className || !SAFE.test(className)) {
        notes.push(`Left out ${f.path}: no class name could be read for PIT.`);
        continue;
      }
      const s = stem(f.path).toLowerCase();
      const tests: string[] = [];
      for (const t of await javaTests()) {
        if (stem(t).toLowerCase() !== s) continue;
        const name = javaClassName(t, await showFile(headSha, t, git));
        if (name && SAFE.test(name)) tests.push(name);
      }
      planned.push({ path: f.path, language: f.language, ranges: r, tool: 'pit', className, testClasses: tests.sort() });
    } else {
      planned.push({ path: f.path, language: f.language, ranges: r, tool: 'none' });
    }
  }
  if (planned.some((p) => p.tool === 'none')) notes.push('Python files are listed but not planned: mutmut results carry no line numbers or killing tests, so testwitness cannot read them (docs/mutation-on-request.md).');

  const mutate = planned.filter((p) => p.tool === 'stryker').flatMap((p) => p.ranges.map(([a, b]) => `${p.path}:${a}-${b}`));
  const strykerReport = 'reports/mutation/mutation.json';
  const pitFiles = planned.filter((p) => p.tool === 'pit');
  const targetClasses = [...new Set(pitFiles.flatMap((p) => [p.className!, `${p.className!}$*`]))];
  const targetTests = new Set<string>();
  for (const p of pitFiles) {
    if (p.testClasses!.length) for (const t of p.testClasses!) targetTests.add(t);
    else {
      const pkg = p.className!.includes('.') ? p.className!.slice(0, p.className!.lastIndexOf('.')) : '';
      targetTests.add(pkg ? `${pkg}.*` : '*');
      notes.push(`No test class named after ${p.className} was found; PIT runs the tests of its package against it.`);
    }
  }
  const pitTests = [...targetTests].sort();
  return {
    base: baseSha,
    head: headSha,
    files: planned,
    stryker: {
      mutate,
      args: mutate.length ? ['stryker', 'run', '--mutate', mutate.join(','), '--incremental', '--coverageAnalysis', 'perTest', '--reporters', 'json,clear-text'] : [],
      report: strykerReport,
    },
    pit: {
      targetClasses,
      targetTests: pitTests,
      args: targetClasses.length
        ? ['-B', 'test-compile', 'org.pitest:pitest-maven:mutationCoverage', `-DtargetClasses=${targetClasses.join(',')}`, `-DtargetTests=${pitTests.join(',')}`, '-DoutputFormats=XML', '-DtimestampedReports=false', '-DfullMutationMatrix=true']
        : [],
      report: 'target/pit-reports/mutations.xml',
    },
    notes,
  };
}

function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The plan as shell variable assignments, safe to `source`: every value is single quoted. */
export function renderMutationPlanShell(plan: MutationPlan): string {
  const lines = [
    `# testwitness mutate-plan: ${plan.files.length} changed production file${plan.files.length === 1 ? '' : 's'}, base ${plan.base.slice(0, 12)}, head ${plan.head.slice(0, 12)}`,
    ...plan.notes.map((n) => `# ${n.replace(/[\r\n]+/g, ' ')}`),
    `TESTWITNESS_BASE=${q(plan.base)}`,
    `TESTWITNESS_HEAD=${q(plan.head)}`,
    `STRYKER_MUTATE=${q(plan.stryker.mutate.join(','))}`,
    `STRYKER_REPORT=${q(plan.stryker.report)}`,
    `PIT_TARGET_CLASSES=${q(plan.pit.targetClasses.join(','))}`,
    `PIT_TARGET_TESTS=${q(plan.pit.targetTests.join(','))}`,
    `PIT_REPORT=${q(plan.pit.report)}`,
  ];
  if (plan.stryker.args.length) lines.push(`# npx ${plan.stryker.args.map(q).join(' ')}`);
  if (plan.pit.args.length) lines.push(`# mvn ${plan.pit.args.map(q).join(' ')}`);
  return lines.join('\n') + '\n';
}
