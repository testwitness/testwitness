import { describe, expect, it } from 'vitest';
import type { ChangedFile, FileKind, RuleContext } from '../types.js';
import { classifyPath } from '../diff/classify.js';
import { C001, C002, C003, isGeneratedPattern, selectorMatches, selectorsOf, thresholdsOf } from './C.js';
import { context } from './testkit.js';

interface Spec {
  path: string;
  base?: string;
  head?: string;
  kind?: FileKind;
}

/** A changed file with one hunk per added line, the way `git diff --unified=0` reports isolated edits. */
function changed(s: Spec): ChangedFile {
  const b = s.base?.split('\n') ?? [];
  const h = s.head?.split('\n') ?? [];
  const bset = new Set(b);
  const hset = new Set(h);
  const hunks = h.flatMap((l, i) => (bset.has(l) ? [] : [{ baseStart: 0, baseCount: 0, headStart: i + 1, headCount: 1, removed: [], added: [l] }]));
  const removed = b.filter((l) => !hset.has(l));
  if (removed.length) hunks.push({ baseStart: 1, baseCount: removed.length, headStart: 0, headCount: 0, removed, added: [] });
  const status = s.base === undefined ? 'added' : s.head === undefined ? 'deleted' : 'modified';
  return { status, path: s.path, kind: s.kind ?? classifyPath(s.path, undefined).kind, hunks, binary: false, addedLines: new Set(), removedLines: new Set() };
}

function ctxFor(specs: Spec[], tests: string[] = []): RuleContext {
  const c = context({ pairs: [] });
  c.files = specs.map(changed);
  const base = new Map(specs.map((s) => [s.path, s.base]));
  const head = new Map(specs.map((s) => [s.path, s.head]));
  c.readBase = async (p) => base.get(p);
  c.readHead = async (p) => head.get(p);
  c.headTestFiles = async () => tests;
  return c;
}

const jest = (body: string) => `module.exports = {\n  testEnvironment: 'node',\n${body}\n};\n`;

describe('C002 thresholds', () => {
  it.each([
    ['jest.config.js', jest('  coverageThreshold: { global: { lines: 90, branches: 80 } },'), ['jest.coverageThreshold.global.lines=90', 'jest.coverageThreshold.global.branches=80']],
    ['package.json', JSON.stringify({ jest: { coverageThreshold: { global: { lines: 70 } } }, nyc: { 'check-coverage': true, lines: 60 } }), ['jest.coverageThreshold.global.lines=70', 'nyc.lines=60']],
    ['vitest.config.ts', "export default defineConfig({ test: { coverage: { provider: 'v8', thresholds: { lines: 85, 'src/core/**': { branches: 95 } } } } })", ['vitest.coverage.thresholds.lines=85', 'vitest.coverage.thresholds.src/core/**.branches=95']],
    ['vite.config.ts', 'export default { test: { coverage: { thresholds: { 100: true } } } }', ['vitest.coverage.thresholds.lines=100', 'vitest.coverage.thresholds.branches=100', 'vitest.coverage.thresholds.functions=100', 'vitest.coverage.thresholds.statements=100']],
    ['.nycrc', '{ "check-coverage": true, "branches": 75 }', ['nyc.branches=75']],
    ['.nycrc.yml', 'check-coverage: false\nlines: 90\n', []],
    ['pytest.ini', '[pytest]\naddopts = -q --cov=app --cov-fail-under=85\n', ['pytest.addopts.--cov-fail-under=85']],
    ['setup.cfg', '[tool:pytest]\naddopts =\n    --cov app\n    --cov-fail-under 80\n[coverage:report]\nfail_under = 75\n', ['pytest.addopts.--cov-fail-under=80', 'coverage.report.fail_under=75']],
    ['.coveragerc', '[run]\nbranch = True\n[report]\nfail_under = 92.5\n', ['coverage.report.fail_under=92.5']],
    ['pyproject.toml', '[tool.pytest.ini_options]\naddopts = ["--cov=app", "--cov-fail-under=88"]\n[tool.coverage.report]\nfail_under = 90\n', ['pytest.addopts.--cov-fail-under=88', 'coverage.report.fail_under=90']],
    ['tox.ini', '[pytest]\naddopts = --cov-fail-under=70\n', ['pytest.addopts.--cov-fail-under=70']],
    [
      'pom.xml',
      '<project><build><plugins><plugin><artifactId>jacoco-maven-plugin</artifactId><executions><execution><configuration><rules><rule><element>BUNDLE</element><limits><limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.80</minimum></limit><limit><counter>CLASS</counter><value>MISSEDCOUNT</value><maximum>3</maximum></limit></limits></rule></rules></configuration></execution></executions></plugin></plugins></build></project>',
      ['jacoco.BUNDLE.LINE.COVEREDRATIO.minimum=80', 'jacoco.BUNDLE.CLASS.MISSEDCOUNT.maximum=3!'],
    ],
    ['build.gradle.kts', 'kover {\n  reports {\n    verify {\n      rule {\n        minBound(80)\n        minBound(60, CoverageUnit.BRANCH)\n      }\n    }\n  }\n}\n', ['kover.minBound.LINE#0=80', 'kover.minBound.BRANCH#1=60']],
    ['build.gradle', 'jacocoTestCoverageVerification {\n  violationRules {\n    rule {\n      limit {\n        counter = "LINE"\n        minimum = 0.75\n      }\n    }\n  }\n}\n', ['jacoco.gradle.LINE.COVEREDRATIO.minimum#0=75']],
    ['codecov.yml', 'coverage:\n  status:\n    project:\n      default:\n        target: 80%\n        threshold: 1%\n    patch:\n      default:\n        target: auto\n', ['codecov.status.project.default.target=80', 'codecov.status.project.default.threshold=1!']],
    ['.coveralls.yml', 'service_name: github\ncoverage_threshold_for_failure: 85\ncoverage_decrease_threshold_for_failure: 0.5\n', ['coveralls.coverage_threshold_for_failure=85', 'coveralls.coverage_decrease_threshold_for_failure=0.5!']],
  ])('reads %s', (path, text, want) => {
    expect(thresholdsOf(path, text).map((t) => `${t.key}=${t.value}${t.inverted ? '!' : ''}`)).toEqual(want);
  });

  it('never throws on unreadable text', () => {
    for (const p of ['package.json', 'pyproject.toml', 'pom.xml', 'codecov.yml', 'jest.config.js', 'setup.cfg']) expect(thresholdsOf(p, '{{{ not [ valid <')).toEqual([]);
  });

  it('reports a lowered threshold as medium on the head line', async () => {
    const ctx = ctxFor([{ path: 'jest.config.js', base: jest('  coverageThreshold: { global: { lines: 90 } },'), head: jest('  coverageThreshold: { global: { lines: 70 } },') }]);
    const out = await C002.run(ctx, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'C002', severity: 'medium', before: '90', after: '70', subject: 'jest.coverageThreshold.global.lines', location: { line: 3 } });
    expect(out[0]!.fingerprint).toBe('C002:jest.config.js:jest.coverageThreshold.global.lines');
  });

  it('reports a removed threshold as high, and a whole deleted config too', async () => {
    const removed = await C002.run(ctxFor([{ path: '.coveragerc', base: '[report]\nfail_under = 90\n', head: '[report]\nshow_missing = true\n' }]), {});
    expect(removed[0]).toMatchObject({ severity: 'high', subject: 'coverage.report.fail_under', location: { line: 2 } });
    const deleted = await C002.run(ctxFor([{ path: 'codecov.yml', base: 'coverage:\n  status:\n    project:\n      default:\n        target: 80%\n' }]), {});
    expect(deleted[0]).toMatchObject({ severity: 'high' });
  });

  it('treats a raised allowed drop as lowered and a removed allowed drop as stricter', async () => {
    const base = 'coverage:\n  status:\n    project:\n      default:\n        target: 80%\n        threshold: 1%\n';
    const raised = await C002.run(ctxFor([{ path: 'codecov.yml', base, head: base.replace('1%', '5%') }]), {});
    expect(raised.map((f) => `${f.subject} ${f.severity}`)).toEqual(['codecov.status.project.default.threshold medium']);
    expect(await C002.run(ctxFor([{ path: 'codecov.yml', base, head: base.replace('        threshold: 1%\n', '') }]), {})).toEqual([]);
  });

  it('is silent when the threshold moved to another file with the same or a higher value', async () => {
    const ctx = ctxFor([
      { path: 'setup.cfg', base: '[tool:pytest]\naddopts = --cov-fail-under=80\n', head: '[tool:pytest]\naddopts = -q\n' },
      { path: '.coveragerc', base: '[run]\nbranch = True\n', head: '[run]\nbranch = True\n[report]\nfail_under = 85\n' },
    ]);
    expect(await C002.run(ctx, {})).toEqual([]);
  });

  it('still reports a move to another file with a lower value', async () => {
    const ctx = ctxFor([
      { path: 'package.json', base: JSON.stringify({ jest: { coverageThreshold: { global: { lines: 90 } } } }), head: JSON.stringify({ jest: {} }) },
      { path: 'jest.config.js', head: jest('  coverageThreshold: { global: { lines: 50 } },') },
    ]);
    expect((await C002.run(ctx, {})).map((f) => f.severity)).toEqual(['high']);
  });

  it('does not treat a new project with its own threshold as a lowering, nor a raise', async () => {
    const ctx = ctxFor([
      { path: 'packages/new/jest.config.js', head: jest('  coverageThreshold: { global: { lines: 40 } },') },
      { path: 'pyproject.toml', base: '[tool.coverage.report]\nfail_under = 80\n', head: '[tool.coverage.report]\nfail_under = 85\n' },
    ]);
    expect(await C002.run(ctx, {})).toEqual([]);
  });

  it('reads jacoco ratios and percents as the same number', async () => {
    const pom = (v: string) => `<project><build><plugins><plugin><artifactId>jacoco-maven-plugin</artifactId><configuration><rules><rule><limits><limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>${v}</minimum></limit></limits></rule></rules></configuration></plugin></plugins></build></project>`;
    expect(await C002.run(ctxFor([{ path: 'pom.xml', base: pom('0.80'), head: pom('80%') }]), {})).toEqual([]);
    expect((await C002.run(ctxFor([{ path: 'pom.xml', base: pom('0.80'), head: pom('0.60') }]), {}))[0]).toMatchObject({ severity: 'medium', before: '80', after: '60' });
  });
});

describe('C003 passing with no tests', () => {
  it.each([
    ['package.json', '    "test": "jest --passWithNoTests",'],
    ['package.json', '    "test": "vitest run --passWithNoTests",'],
    ['vitest.config.ts', '    passWithNoTests: true,'],
    ['jest.config.js', '  passWithNoTests: true,'],
    ['.github/workflows/ci.yml', '        run: npx playwright test --pass-with-no-tests'],
    ['pom.xml', '          <failIfNoTests>false</failIfNoTests>'],
    ['.github/workflows/ci.yml', '        run: mvn -B verify -DfailIfNoTests=false'],
    ['build.gradle', '    failOnNoDiscoveredTests = false'],
    ['build.gradle.kts', '    filter.failOnNoMatchingTests = false'],
    ['build.gradle.kts', '    failOnNoDiscoveredTests.set(false)'],
    ['pytest.ini', 'addopts = --suppress-no-test-exit-code'],
    ['Makefile', '\tpytest --suppress-no-test-exit-code tests/'],
  ])('flags %s: %s', async (path, line) => {
    const out = await C003.run(ctxFor([{ path, base: 'first\nlast', head: `first\n${line}\nlast` }]), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'C003', severity: 'high', location: { line: 2 } });
  });

  it('is silent when the base already had it, on moved lines, comments, false values and unrelated files', async () => {
    const run = async (s: Spec) => C003.run(ctxFor([s]), {});
    expect(await run({ path: 'package.json', base: '"lint": "jest --passWithNoTests"', head: '"lint": "jest --passWithNoTests"\n"test": "jest --passWithNoTests"' })).toEqual([]);
    expect(await run({ path: 'jest.config.js', base: 'a', head: 'a\n// passWithNoTests: true,' })).toEqual([]);
    expect(await run({ path: 'jest.config.js', base: 'a', head: 'a\n  passWithNoTests: false,' })).toEqual([]);
    expect(await run({ path: 'package.json', base: 'a', head: 'a\n"test": "jest --passWithNoTests=false"' })).toEqual([]);
    expect(await run({ path: 'src/app.ts', base: 'a', head: 'a\nconst passWithNoTests: true = x;' })).toEqual([]);
  });
});

describe('C001 selectors', () => {
  it.each([
    ['pytest.ini', '[pytest]\naddopts = -q --ignore=tests/slow --deselect tests/test_a.py::test_x -k "not flaky"\ntestpaths = tests\nnorecursedirs = legacy', ['exclude pytest.addopts --ignore tests/slow', 'exclude pytest.addopts --deselect tests/test_a.py::test_x', 'exclude pytest.addopts -k not flaky', 'include pytest.testpaths tests', 'exclude pytest.norecursedirs legacy']],
    ['pyproject.toml', '[tool.pytest.ini_options]\naddopts = ["--ignore-glob=*_e2e.py"]\ntestpaths = ["tests/unit"]\n', ['exclude pytest.addopts --ignore-glob *_e2e.py', 'include pytest.testpaths tests/unit']],
    ['jest.config.ts', "export default { testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/legacy/'], testMatch: ['**/*.test.ts'] };", ['exclude jest.testPathIgnorePatterns /node_modules/', 'exclude jest.testPathIgnorePatterns <rootDir>/src/legacy/', 'include jest.testMatch **/*.test.ts']],
    ['vitest.config.ts', "export default defineConfig({ test: { include: ['src/**/*.test.ts'], exclude: [...configDefaults.exclude, 'src/slow/**'], coverage: { include: ['src/**'], exclude: ['src/gen/**'] } } })", ['include vitest.test.include src/**/*.test.ts', 'exclude vitest.test.exclude src/slow/**']],
    ['playwright.config.ts', "export default defineConfig({ testDir: './e2e', testIgnore: /.*legacy.*\\.spec\\.ts/, projects: [{ name: 'x', testIgnore: '**/flaky/**' }] })", ['exclude playwright.testIgnore .*legacy.*\\.spec\\.ts', 'exclude playwright.testIgnore **/flaky/**']],
    ['.mocharc.yml', "spec: 'test/**/*.spec.js'\nignore:\n  - 'test/slow/**'\n", ['include mocha.spec test/**/*.spec.js', 'exclude mocha.ignore test/slow/**']],
    ['.mocharc.js', "module.exports = { spec: ['test/unit/**/*.js'], ignore: ['test/unit/old/**'] };", ['include mocha.spec test/unit/**/*.js', 'exclude mocha.ignore test/unit/old/**']],
    [
      'pom.xml',
      '<project><build><plugins><plugin><artifactId>maven-surefire-plugin</artifactId><configuration><excludes><exclude>**/PaymentsTest.java</exclude></excludes><includes><include>**/*Test.java</include></includes><excludedGroups>slow, network</excludedGroups><classpathDependencyExcludes><classpathDependencyExclude>x:y</classpathDependencyExclude></classpathDependencyExcludes></configuration></plugin></plugins></build></project>',
      ['exclude surefire.excludes **/PaymentsTest.java', 'include surefire.includes **/*Test.java', 'exclude surefire.excludedGroups slow', 'exclude surefire.excludedGroups network'],
    ],
    ['build.gradle', "dependencies {\n  testImplementation('junit:junit:4.13.2') { exclude group: 'org.hamcrest' }\n}\ntest {\n  exclude '**/LegacyTest*', '**/Old*'\n  filter { excludeTestsMatching 'com.acme.slow.*' }\n  useJUnitPlatform { excludeTags 'slow' }\n}\njar { exclude 'META-INF/*.SF' }\n", ['exclude gradle.test.exclude **/LegacyTest*', 'exclude gradle.test.exclude **/Old*', 'exclude gradle.test.filter.excludeTestsMatching com.acme.slow.*', 'exclude gradle.test.excludeTags slow']],
    ['build.gradle.kts', 'tasks.test {\n  useJUnitPlatform {\n    excludeTags("integration", "slow")\n  }\n  filter {\n    excludeTestsMatching("*IT")\n  }\n}\n', ['exclude gradle.test.excludeTestsMatching *IT'.replace('gradle.test.excludeTestsMatching', 'gradle.test.filter.excludeTestsMatching'), 'exclude gradle.test.excludeTags integration', 'exclude gradle.test.excludeTags slow']],
    ['testng.xml', '<suite name="s"><test name="t"><groups><run><exclude name="broken"/></run></groups><classes><class name="demo.PricingTest"><methods><exclude name="appliesRates"/></methods></class></classes></test></suite>', ['exclude testng.groups.exclude broken', 'exclude testng.methods.exclude demo.PricingTest#appliesRates']],
    ['junit-platform.properties', 'junit.jupiter.conditions.deactivate=org.junit.*DisabledCondition\n', ['switch junit.jupiter.conditions.deactivate org.junit.*DisabledCondition']],
  ])('reads %s', (path, text, want) => {
    expect(selectorsOf(path, text).map((s) => `${s.kind} ${s.key} ${s.pattern}`).sort()).toEqual([...want].sort());
  });

  it('recognises generated directories', () => {
    for (const p of ['/node_modules/', '<rootDir>/dist/', '**/build/**', 'target', '.venv', '\\.venv/', '.*']) expect(isGeneratedPattern(p), p).toBe(true);
    for (const p of ['src/legacy/', '**/builder/**', 'tests/slow']) expect(isGeneratedPattern(p), p).toBe(false);
  });

  it('matches selectors against head test files', () => {
    const tests = ['tests/slow/test_big.py', 'tests/test_a.py', 'src/legacy/old.test.ts', 'src/test/java/com/acme/LegacyTest.java', 'src/test/java/com/acme/slow/BigTest.java', 'web/e2e/legacy.spec.ts'];
    const m = (match: Parameters<typeof selectorMatches>[0]['match'], pattern: string, root = '') => selectorMatches({ key: 'k', kind: 'exclude', pattern, match, root }, tests);
    expect(m('prefix', 'tests/slow')).toEqual(['tests/slow/test_big.py']);
    expect(m('prefix', './tests/slow/')).toEqual(['tests/slow/test_big.py']);
    expect(m('nodeid', 'tests/test_a.py::test_x')).toEqual(['tests/test_a.py']);
    expect(m('dirname', 'sl*')).toEqual(['tests/slow/test_big.py', 'src/test/java/com/acme/slow/BigTest.java']);
    expect(m('regex', '<rootDir>/src/legacy/')).toEqual(['src/legacy/old.test.ts']);
    expect(m('glob', '**/legacy/**')).toEqual(['src/legacy/old.test.ts']);
    expect(m('glob', 'e2e/legacy.spec.ts', 'web')).toEqual(['web/e2e/legacy.spec.ts']);
    expect(m('jvm-path', '**/LegacyTest*')).toEqual(['src/test/java/com/acme/LegacyTest.java']);
    expect(m('jvm-path', '**/LegacyTest.class')).toEqual(['src/test/java/com/acme/LegacyTest.java']);
    expect(m('jvm-path', '%regex[.*slow.*]')).toEqual(['src/test/java/com/acme/slow/BigTest.java']);
    expect(m('jvm-class', 'com.acme.slow.*')).toEqual(['src/test/java/com/acme/slow/BigTest.java']);
    expect(m('jvm-class', 'LegacyTest')).toEqual(['src/test/java/com/acme/LegacyTest.java']);
    expect(m('glob', '**/nothing/**')).toEqual([]);
    expect(m('none', 'slow')).toBeUndefined();
    expect(m('regex', '(unclosed')).toBeUndefined();
  });
});

describe('C001 test selection narrowed', () => {
  const tests = ['tests/test_api.py', 'tests/integration/test_db.py', 'src/payments/pay.test.ts', 'src/cart.test.ts'];

  it('reports an exclusion that drops test files as high, with the count', async () => {
    const out = await C001.run(ctxFor([{ path: 'pytest.ini', base: '[pytest]\naddopts = -q\n', head: '[pytest]\naddopts = -q --ignore=tests/integration\n' }], tests), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'high', subject: 'pytest.addopts --ignore tests/integration', location: { line: 2 } });
    expect(out[0]!.message).toContain('1 test file (tests/integration/test_db.py)');
    expect(out[0]!.fingerprint).toBe('C001:pytest.ini:pytest.addopts --ignore tests/integration');
  });

  it('reports an exclusion that matches nothing as low, and generated directories not at all', async () => {
    const base = jest("  testPathIgnorePatterns: ['/node_modules/'],");
    const head = jest("  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/', '<rootDir>/src/archive/'],");
    const out = await C001.run(ctxFor([{ path: 'jest.config.js', base, head }], tests), {});
    expect(out.map((f) => `${f.severity} ${f.label ?? ''} ${f.subject}`)).toEqual(['low matches nothing jest.testPathIgnorePatterns <rootDir>/src/archive/']);
  });

  it('reports filters it cannot match to files as high', async () => {
    const out = await C001.run(ctxFor([{ path: 'setup.cfg', base: '[tool:pytest]\naddopts = -q\n', head: '[tool:pytest]\naddopts = -q -k "not payments"\n' }], tests), {});
    expect(out[0]).toMatchObject({ severity: 'high', subject: 'pytest.addopts -k not payments' });
  });

  it('reports an include list that lost files, and is silent when the remaining patterns still cover them', async () => {
    const narrowed = await C001.run(ctxFor([{ path: 'pyproject.toml', base: '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n', head: '[tool.pytest.ini_options]\ntestpaths = ["tests/unit", "tests/test_api.py"]\n' }], tests), {});
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]).toMatchObject({ severity: 'high', before: 'tests' });
    expect(narrowed[0]!.message).toContain('tests/integration/test_db.py');
    const widened = await C001.run(ctxFor([{ path: 'jest.config.js', base: jest("  testMatch: ['<rootDir>/src/**/*.test.ts'],"), head: jest("  testMatch: ['**/*.test.ts'],") }], tests), {});
    expect(widened).toEqual([]);
  });

  it('is silent for an exclusion moved from package.json to jest.config.js, and for unchanged exclusions', async () => {
    const pkgBase = JSON.stringify({ jest: { testPathIgnorePatterns: ['<rootDir>/src/payments/'] } }, null, 2);
    const pkgHead = JSON.stringify({ name: 'x' }, null, 2);
    const moved = await C001.run(ctxFor([{ path: 'package.json', base: pkgBase, head: pkgHead }, { path: 'jest.config.js', head: jest("  testPathIgnorePatterns: ['<rootDir>/src/payments/'],") }], tests), {});
    expect(moved).toEqual([]);
    const same = await C001.run(ctxFor([{ path: 'package.json', base: pkgBase, head: pkgBase.replace('{', '{\n  "private": true,') }], tests), {});
    expect(same).toEqual([]);
  });

  it('reports junit conditions deactivated as medium', async () => {
    const out = await C001.run(ctxFor([{ path: 'src/test/resources/junit-platform.properties', base: 'junit.jupiter.execution.parallel.enabled=true\n', head: 'junit.jupiter.execution.parallel.enabled=true\njunit.jupiter.conditions.deactivate=*\n' }], tests), {});
    expect(out[0]).toMatchObject({ severity: 'medium', location: { line: 2 } });
  });

  it('reads nothing from files it does not know', async () => {
    expect(await C001.run(ctxFor([{ path: 'src/app.ts', base: 'a', head: "a\nconst testPathIgnorePatterns = ['x'];" }], tests), {})).toEqual([]);
  });
});
