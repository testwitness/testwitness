import picomatch from 'picomatch';
import type { ChangedFile, FileKind, LanguageId } from '../types.js';

export interface ClassifyOptions {
  /** Extra test globs from config. Replace defaults when provided and non empty. */
  testGlobs?: string[];
  ignoreGlobs?: string[];
}

export const DEFAULT_TEST_GLOBS = [
  // Java
  '**/*Test.java',
  '**/*Tests.java',
  '**/*IT.java',
  '**/*TestCase.java',
  '**/src/test/**/*.java',
  '**/src/test/**/*.kt',
  // TS / JS
  '**/*.test.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  '**/*.spec.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  '**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  '**/test/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  '**/tests/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  '**/e2e/**/*.{ts,js}',
  // Python
  '**/test_*.py',
  '**/*_test.py',
  '**/tests/**/*.py',
  '**/test/**/*.py',
];

export const SNAPSHOT_GLOBS = [
  '**/__snapshots__/**',
  '**/*.snap',
  '**/*.approved.*',
  '**/*.received.*',
  '**/*.verified.*',
  '**/*.golden',
  '**/testdata/**/*.golden',
  '**/__screenshots__/**',
  '**/*-snapshots/**',
  '**/snapshots/**',
  '**/__snapshots__/**/*.ambr',
  '**/expected/**',
];

export const RUNNER_CONFIG_FILES = [
  '**/jest.config.{js,cjs,mjs,ts,cts,mts,json}',
  '**/vitest.config.{js,cjs,mjs,ts,cts,mts}',
  '**/vitest.workspace.{js,ts}',
  '**/vite.config.{js,ts,mjs,mts}',
  '**/playwright.config.{js,ts,mjs,mts}',
  '**/.mocharc.{js,cjs,yml,yaml,json,jsonc}',
  '**/package.json',
  '**/pytest.ini',
  '**/pyproject.toml',
  '**/setup.cfg',
  '**/tox.ini',
  '**/noxfile.py',
  '**/conftest.py',
  '**/pom.xml',
  '**/build.gradle',
  '**/build.gradle.kts',
  '**/settings.gradle',
  '**/settings.gradle.kts',
  '**/gradle.properties',
  '**/junit-platform.properties',
  '**/testng.xml',
  '**/testng*.xml',
  '**/Makefile',
  '**/.testwitness.yml',
];

export const COVERAGE_CONFIG_FILES = [
  '**/.coveragerc',
  '**/codecov.yml',
  '**/.codecov.yml',
  '**/.coveralls.yml',
  '**/.nycrc',
  '**/.nycrc.json',
  '**/.nycrc.{yml,yaml}',
  '**/codecov.yaml',
  '**/.codecov.yaml',
  '**/sonar-project.properties',
  '**/stryker.config.{js,mjs,json}',
  '**/stryker.conf.{js,json}',
];

export const CI_WORKFLOW_GLOBS = [
  '.github/workflows/*.{yml,yaml}',
  '**/.gitlab-ci.yml',
  '**/.gitlab/**/*.yml',
  '**/Jenkinsfile',
  '**/azure-pipelines.yml',
  '**/.circleci/config.yml',
  '**/bitbucket-pipelines.yml',
];

export const LOCKFILES = [
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/bun.lock',
  '**/poetry.lock',
  '**/uv.lock',
  '**/Pipfile.lock',
  '**/requirements*.txt',
  '**/gradle.lockfile',
];

const opts = { dot: true };
const isTestDefault = picomatch(DEFAULT_TEST_GLOBS, opts);
const isSnapshot = picomatch(SNAPSHOT_GLOBS, opts);
const isRunnerConfig = picomatch(RUNNER_CONFIG_FILES, opts);
const isCoverageConfig = picomatch(COVERAGE_CONFIG_FILES, opts);
const isWorkflow = picomatch(CI_WORKFLOW_GLOBS, opts);
const isLockfile = picomatch(LOCKFILES, opts);

export function languageOf(path: string): LanguageId | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.java')) return 'java';
  if (/\.(ts|tsx|mts|cts)$/.test(lower)) return 'typescript';
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  return undefined;
}

/** Content sniff for test files in unusual paths. */
export function looksLikeTestSource(language: LanguageId | undefined, source: string): boolean {
  if (!source) return false;
  switch (language) {
    case 'java':
      return /@(Test|ParameterizedTest|RepeatedTest|TestFactory|org\.junit\.[\w.]*Test)\b/.test(source);
    case 'typescript':
    case 'javascript':
      // One whitespace run on each side of the optional `.only`: two adjacent `\s*` were quadratic on `describe` and a long run of spaces.
      // A member call is not a test declaration: `schema.describe("...")` and `pattern.test(value)` in production
      // code (a validation schema, a regular expression) made the file a test file. `test.describe(` stays one.
      return /(?<![.\w$])(?:test\.)?(describe|context|suite)\s*(?:\.\w+\s*)?\(/.test(source) && /(?<![.\w$])(it|test|specify)\s*(?:\.\w+\s*)?\(/.test(source);
    case 'python':
      // Indentation only after `^`: `^\s*` ran over every following blank line from each line start, quadratic on a file of newlines.
      return /^[^\S\r\n\u2028\u2029]*(async\s+)?def\s+test_?\w*\s*\(/m.test(source) || /\bunittest\.TestCase\b/.test(source);
    default:
      return false;
  }
}

export function classifyPath(path: string, source: string | undefined, options: ClassifyOptions = {}): { kind: FileKind; language?: LanguageId } {
  const language = languageOf(path);
  const ignore = options.ignoreGlobs?.length ? picomatch(options.ignoreGlobs, opts) : undefined;
  if (ignore?.(path)) return { kind: 'other', ...(language ? { language } : {}) };

  const testMatcher = options.testGlobs?.length ? picomatch(options.testGlobs, opts) : isTestDefault;

  // conftest.py is configuration, not a test file.
  const baseName = path.split('/').pop() ?? path;
  if (baseName === 'conftest.py') return { kind: 'runner-config', language: 'python' };
  if (baseName === '__init__.py') return { kind: 'other', language: 'python' };

  if (isSnapshot(path) && !testMatcher(path)) return { kind: 'snapshot' };
  if (isWorkflow(path)) return { kind: 'ci-workflow' };
  if (isLockfile(path)) return { kind: 'lockfile' };
  if (isCoverageConfig(path)) return { kind: 'coverage-config' };

  if (language) {
    if (testMatcher(path) || (source !== undefined && looksLikeTestSource(language, source))) {
      return { kind: 'test', language };
    }
  }
  if (isRunnerConfig(path)) return { kind: 'runner-config', ...(language ? { language } : {}) };
  if (language) return { kind: 'production', language };
  return { kind: 'other' };
}

export function classifyFiles(files: ChangedFile[], sourceOf: (f: ChangedFile) => string | undefined, options: ClassifyOptions = {}): ChangedFile[] {
  for (const f of files) {
    const probePath = f.status === 'deleted' ? f.path : f.path;
    const { kind, language } = classifyPath(probePath, sourceOf(f), options);
    f.kind = kind;
    if (language) f.language = language;
    else delete f.language;
  }
  return files;
}
