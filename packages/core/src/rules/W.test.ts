import { describe, expect, it } from 'vitest';
import type { ChangedFile, FileKind } from '../types.js';
import { CONFIG_SUPPRESSORS, INLINE_SUPPRESSORS, S004, SNAPSHOT_UPDATE, TEST_COMMAND, W003, stripYamlAndJson } from './W.js';
import type { Suppressor } from './W.js';
import { context } from './testkit.js';

function file(path: string, kind: FileKind, added: string[], removed: string[] = []): ChangedFile {
  return { status: 'modified', path, kind, hunks: [{ baseStart: 1, baseCount: removed.length, headStart: 10, headCount: added.length, added, removed }], binary: false, addedLines: new Set(), removedLines: new Set() };
}
function ctxWith(...files: ChangedFile[]) {
  const c = context({ pairs: [] });
  c.files = files;
  return c;
}

describe('W003 failure suppressed', () => {
  it.each([
    ['        run: pytest -q || true', '|| true'],
    ['        run: npm test || exit 0', '|| exit 0'],
    ['        run: ./gradlew test || :', '|| :'],
    ['        run: mvn -B verify -DskipTests', '-DskipTests'],
    ['        run: mvn test -DtestFailureIgnore=true', '-DtestFailureIgnore=true'],
    ['        run: npx jest 2>&1 | tail -20', 'piped to a filter'],
    ['    "test": "vitest run || echo tests failed",', '|| echo'],
    ['        run: ./gradlew build -x test', '-x test'],
  ])('flags %s', async (line, what) => {
    const out = await W003.run(ctxWith(file('.github/workflows/ci.yml', 'ci-workflow', [line])), {});
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain(what);
    expect(out[0]!.severity).toBe('high');
    expect(out[0]!.location.line).toBe(10);
  });
  it('flags config forms in pom and gradle', async () => {
    const pom = file('pom.xml', 'runner-config', ['      <testFailureIgnore>true</testFailureIgnore>']);
    const gradle = file('build.gradle', 'runner-config', ['test { ignoreFailures = true }']);
    expect(await W003.run(ctxWith(pom, gradle), {})).toHaveLength(2);
  });
  it('flags set +e ahead of a test command in the same hunk', async () => {
    const out = await W003.run(ctxWith(file('scripts/ci.sh', 'other', ['set +e', 'pytest tests/', 'echo done'])), {});
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('set +e');
  });
  it('ignores suppressors on non test commands, moved lines, deleted files and unrelated files', async () => {
    expect(await W003.run(ctxWith(file('.github/workflows/ci.yml', 'ci-workflow', ['        run: rm -rf dist || true'])), {})).toEqual([]);
    expect(await W003.run(ctxWith(file('.github/workflows/ci.yml', 'ci-workflow', ['        run: pytest || true'], ['        run: pytest || true'])), {})).toEqual([]);
    const del = file('.github/workflows/ci.yml', 'ci-workflow', ['run: pytest || true']);
    del.status = 'deleted';
    expect(await W003.run(ctxWith(del), {})).toEqual([]);
    expect(await W003.run(ctxWith(file('src/app.ts', 'production', ['// run: pytest || true'])), {})).toEqual([]);
  });
});

describe('S004 snapshot update enabled', () => {
  it.each([
    ['    "test": "jest -u",'],
    ['    "test": "jest --ci=false",'],
    ['        run: UPDATE_SNAPSHOTS=1 npm test'],
    ['        run: pytest --snapshot-update'],
    ['        run: npx playwright test --update-snapshots'],
    ['    "test": "vitest run --update",'],
  ])('flags %s', async (line) => {
    const out = await S004.run(ctxWith(file('package.json', 'runner-config', [line])), {});
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('high');
  });
  it('reports --ci dropped from jest as medium', async () => {
    const out = await S004.run(ctxWith(file('package.json', 'runner-config', ['    "test": "jest",'], ['    "test": "jest --ci",'])), {});
    expect(out[0]).toMatchObject({ severity: 'medium' });
    expect(out[0]!.message).toContain('--ci');
  });
  it('ignores -u on non snapshot tools and unchanged lines', async () => {
    expect(await S004.run(ctxWith(file('package.json', 'runner-config', ['    "fmt": "prettier -u",'])), {})).toEqual([]);
    expect(await S004.run(ctxWith(file('package.json', 'runner-config', ['    "test": "jest -u",'], ['    "test": "jest -u",'])), {})).toEqual([]);
  });
});

describe('W006 gate weakened', () => {
  it('reports config file changes and workflow lines mentioning testwitness, ignores other workflows', async () => {
    const { W006 } = await import('./W.js');
    const cfg = file('.testwitness.yml', 'runner-config', ['  R003: off'], ['  R003: high']);
    const wf = file('.github/workflows/testwitness.yml', 'ci-workflow', ['          mode: report'], ['          mode: strict']);
    const other = file('.github/workflows/ci.yml', 'ci-workflow', ['      - run: npm test']);
    const ctx = ctxWith(cfg, wf, other);
    ctx.readHead = async (p) => (p.endsWith('testwitness.yml') ? 'steps:\n  - uses: testwitness/testwitness@v1\n    with:\n      mode: report' : 'steps:\n  - run: npm test');
    const out = await W006.run(ctx, {});
    expect(out.map((f) => [f.ruleId, f.severity, f.label, f.location.path])).toEqual([
      ['W006', 'high', 'maintainer only', '.testwitness.yml'],
      ['W006', 'high', 'maintainer only', '.github/workflows/testwitness.yml'],
    ]);
  });
});

describe('W002 continue-on-error', () => {
  const wf = `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - name: Unit tests\n        continue-on-error: true\n        run: ./gradlew test\n      - name: Upload\n        continue-on-error: true\n        run: ./upload.sh\n  e2e:\n    continue-on-error: true\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx playwright test\n`;
  it('reports the test step and the test job, not the upload step', async () => {
    const { W002 } = await import('./W.js');
    const f = file('.github/workflows/ci.yml', 'ci-workflow', ['        continue-on-error: true']);
    f.hunks = [
      { baseStart: 7, baseCount: 0, headStart: 7, headCount: 1, added: ['        continue-on-error: true'], removed: [] },
      { baseStart: 10, baseCount: 0, headStart: 10, headCount: 1, added: ['        continue-on-error: true'], removed: [] },
      { baseStart: 13, baseCount: 0, headStart: 13, headCount: 1, added: ['    continue-on-error: true'], removed: [] },
    ];
    const ctx = ctxWith(f);
    ctx.readHead = async () => wf;
    const out = await W002.run(ctx, {});
    expect(out.map((x) => [x.location.line, x.subject])).toEqual([
      [7, 'run: ./gradlew test'],
      [13, 'run: npx playwright test'],
    ]);
  });
});

/** Table helper: every entry of a suppressor array needs a row, and every row needs an entry. */
function checkTable(entries: Suppressor[], table: Record<string, { hits: string[]; misses: string[] }>): void {
  it('has a row for every entry and no extra rows', () => {
    expect(Object.keys(table).sort()).toEqual(entries.map((e) => e.what).sort());
    expect(new Set(entries.map((e) => e.what)).size).toBe(entries.length);
  });
  for (const entry of entries) {
    it(`${entry.what} matches its lines and rejects near misses`, () => {
      const row = table[entry.what];
      expect(row, `row for ${entry.what}`).toBeDefined();
      expect(row!.hits.length).toBeGreaterThan(0);
      expect(row!.misses.length).toBeGreaterThan(0);
      for (const line of row!.hits) expect(entry.re.test(line), `should match: ${line}`).toBe(true);
      for (const line of row!.misses) expect(entry.re.test(line), `should not match: ${line}`).toBe(false);
    });
  }
}

describe('INLINE_SUPPRESSORS', () => {
  checkTable(INLINE_SUPPRESSORS, {
    '|| true': { hits: ['pytest || true', 'pytest ||true', 'npm test ||   true # ok'], misses: ['pytest || trueish', 'pytest | true', 'pytest && true'] },
    '|| exit 0': { hits: ['npm test || exit 0', 'npm test ||exit 0'], misses: ['npm test || exit 01', 'npm test || exit 1', 'npm test | exit 0'] },
    '|| :': { hits: ['./gradlew test || :', 'jest || : ', 'jest ||:'], misses: ['jest || :foo', 'jest | :', 'jest || ;'] },
    '|| echo': { hits: ['vitest run || echo tests failed', 'jest ||echo x'], misses: ['vitest run || echoes', 'vitest run | echo x', 'vitest run && echo x'] },
    '; true': { hits: ['pytest; true', 'pytest ;  true  ', 'pytest;true'], misses: ['pytest; true story', 'pytest, true', 'pytest && true'] },
    '; echo': { hits: ['pytest; echo done', 'pytest ;echo done now'], misses: ['pytest; echo a; b', 'pytest; echo a | b', 'pytest; echo a && b', 'pytest, echo done'] },
    'piped to a filter without pipefail': {
      hits: ['npx jest 2>&1 | tail -20', 'pytest 2>&1|head', 'pytest 2>&1 | grep FAIL', 'pytest 2>&1 | cat', 'pytest 2>&1 | tee out.log'],
      misses: ['pytest 2>&1 | tailor', 'pytest 2>&1 | sort', 'pytest 2> err | tail', 'pytest | tail'],
    },
    '-DskipTests': { hits: ['mvn -B verify -DskipTests', 'mvn -DskipTests package'], misses: ['mvn -DskipTestsX package', 'mvn -skipTests', 'mvn DskipTests'] },
    '-Dmaven.test.skip': { hits: ['mvn -Dmaven.test.skip package', 'mvn -Dmaven.test.skip=true package'], misses: ['mvn -Dmaven.test.skipped package', 'mvn -Dmavenxtest.skip', 'mvn -Dmaven.test.run'] },
    '-DtestFailureIgnore=true': { hits: ['mvn test -DtestFailureIgnore=true'], misses: ['mvn test -DtestFailureIgnore=false', 'mvn test -DtestFailureIgnore=trueish', 'mvn test -DtestFailureIgnore'] },
    'failIfNoSpecifiedTests=false': { hits: ['mvn test -Dsurefire.failIfNoSpecifiedTests=false'], misses: ['mvn test -Dsurefire.failIfNoSpecifiedTests=true', 'mvn test -Dsurefire.failIfNoSpecifiedTests=falsey', 'mvn test -Dsurefire.failIfNoTests=false'] },
    '-x test': { hits: ['./gradlew build -x test', 'gradle build   -x   test'], misses: ['./gradlew build -x tests', './gradlew build -xtest', './gradlew build x test', './gradlew build -x lint'] },
    '--exitcode 0': {
      hits: ['tool --exitcode 0', 'tool --exitcode=0', 'tool --exit-code 0', 'tool --exit-code=0', 'tool --exitcode = 0'],
      misses: ['tool --exitcode 1', 'tool --exit-code=05', 'tool --exitcodes 0', 'tool --code 0'],
    },
    '|| false': { hits: ['run: x || ${{ false }}', 'x || ${false}', 'x ||$false'], misses: ['x || ${{ true }}', 'x | ${{ false }}', 'x || false'] },
  });
});

describe('CONFIG_SUPPRESSORS', () => {
  checkTable(CONFIG_SUPPRESSORS, {
    '<testFailureIgnore>true': { hits: ['<testFailureIgnore>true</testFailureIgnore>', '<testFailureIgnore> true </testFailureIgnore>'], misses: ['<testFailureIgnore>false</testFailureIgnore>', '<testFailureIgnore>true</other>', '<testFailureIgnore>true'] },
    'ignoreFailures = true': { hits: ['ignoreFailures = true', 'ignoreFailures: true', 'ignoreFailures=true', 'test { ignoreFailures = true }'], misses: ['ignoreFailures = false', 'ignoreFailures = trueish', 'noignoreFailures = true', 'ignoreFailures true'] },
    '<skipTests>true': { hits: ['<skipTests>true</skipTests>', '<skipTests> true </skipTests>'], misses: ['<skipTests>false</skipTests>', '<skipTest>true</skipTest>', '<skipTests>true'] },
    '<skip>true': { hits: ['<skip>true</skip>', '<skip>  true</skip>'], misses: ['<skip>false</skip>', '<skips>true</skips>', '<skip>true</other>'] },
    '<maven.test.skip>true': { hits: ['<maven.test.skip>true</maven.test.skip>', '<maven.test.skip> true</maven.test.skip>'], misses: ['<maven.test.skip>false</maven.test.skip>', '<maven.test.run>true</maven.test.run>', '<maven.test.skip>true</skip>'] },
    'test { enabled = false }': { hits: ['test { enabled = false }', 'test{enabled=false}', 'tasks.named("x") { } ; test {  enabled = false'], misses: ['test { enabled = true }', 'contest { enabled = false }', 'test { enabled false }', 'test enabled = false'] },
    'test task disabled': {
      hits: ['tasks.test { enabled = false }', 'tasks.test { useJUnit(); enabled = false }', 'tasks.withType<Test> { enabled = false }'],
      misses: ['tasks.test { enabled = true }', 'tasks.build { enabled = false }', 'tasks.test enabled = false', 'tasks.test { useJUnit() }\nenabled = false'],
    },
  });
});

describe('SNAPSHOT_UPDATE', () => {
  checkTable(SNAPSHOT_UPDATE, {
    '-u': {
      hits: ['jest -u', 'jest --ci -u', 'vitest run -u', 'jest --updateSnapshot', 'vitest run --update', 'vitest --update'],
      misses: ['jest --ci', 'jest --coverage', 'jest --updates', 'jest -uv', 'jest && echo -u', 'jest | grep -u', 'pytest -u', 'jestx -u'],
    },
    '--ci=false': { hits: ['jest --ci=false', 'jest --coverage --ci=false'], misses: ['jest --ci=true', 'jest --ci', 'vitest --ci=false', 'jest && x --ci=false'] },
    'UPDATE_SNAPSHOTS=1': { hits: ['UPDATE_SNAPSHOTS=1 npm test', 'UPDATE_SNAPSHOT=1 npm test', 'env UPDATE_SNAPSHOTS=1'], misses: ['UPDATE_SNAPSHOTS=0 npm test', 'UPDATE_SNAPSHOTS=10', 'XUPDATE_SNAPSHOTS=1', 'UPDATE_SNAPSHOTS=true'] },
    'SNAPSHOT_UPDATE=1': { hits: ['SNAPSHOT_UPDATE=1 pytest', 'export SNAPSHOT_UPDATE=1'], misses: ['SNAPSHOT_UPDATE=0 pytest', 'SNAPSHOT_UPDATE=12', 'MY_SNAPSHOT_UPDATE=1'] },
    'UPDATE_EXPECT=1': { hits: ['UPDATE_EXPECT=1 cargo test', 'export UPDATE_EXPECT=1'], misses: ['UPDATE_EXPECT=0 cargo test', 'UPDATE_EXPECT=11', 'MY_UPDATE_EXPECT=1'] },
    '--snapshot-update': { hits: ['pytest --snapshot-update', 'pytest tests/ -q --snapshot-update'], misses: ['pytest --snapshot-updated', 'pytest --snapshot-warn-unused', 'pytest && x --snapshot-update', 'tox --snapshot-update'] },
    '--force-regen': { hits: ['pytest --force-regen', 'pytest -q --force-regen'], misses: ['pytest --force-regenerate', 'pytest --regen', 'tox --force-regen', 'pytest | x --force-regen'] },
    '--update-snapshots': { hits: ['playwright test --update-snapshots', 'npx playwright test e2e --update-snapshots'], misses: ['playwright test --update-snapshotsx', 'playwright test --reporter=list', 'playwright --update-snapshots', 'playwright test; x --update-snapshots'] },
    '--approve': { hits: ['approvaltests --approve', 'run.sh --approve --all'], misses: ['approvaltests --approved', 'approvaltests --approval', 'approvaltests -approve'] },
    'updateSnapshot: all': { hits: ["updateSnapshot: 'all'", 'updateSnapshot: "new"', 'updateSnapshot: all', 'updateSnapshot : new,'], misses: ["updateSnapshot: 'none'", 'updateSnapshot: false', 'updateSnapshots: all', 'updateSnapshot all'] },
    'snapshot update: true': { hits: ['snapshots: { update: true }', 'snapshot: { update: true }', 'snapshot: { x: 1, update: true }'], misses: ['snapshots: { update: false }', 'snapshots: { updated: true }', 'snapshots: { x: 1 }', 'snapshots: update: true'] },
    'ci: false': { hits: ['ci: false', '  ci : false', 'jest = { ci: false }'], misses: ['ci: true', 'circleci: false', 'ci: falsey', 'ci false'] },
  });
});

describe('TEST_COMMAND alternatives', () => {
  it.each([
    'npm test',
    'npm run test',
    'npm t',
    'npm run t',
    'yarn test',
    'yarn run test',
    'pnpm test',
    'pnpm run test',
    'bun test',
    'npx jest',
    'npx vitest',
    'npx playwright',
    'npx mocha',
    'npx ava',
    'npx tap',
    'npx jasmine',
    'npx cypress',
    'jest --ci',
    'vitest run',
    'playwright test',
    'mocha spec/',
    'pytest -q',
    'python -m pytest',
    'python3 -m pytest',
    'python -m unittest',
    'python3 -m unittest discover',
    'nose2',
    'nose',
    'tox -e py311',
    'nox -s tests',
    'mvn test',
    'mvn verify',
    'mvn install',
    'mvn package',
    'mvnw test',
    'mvn -B -q test',
    'mvn -Dfoo=bar -B verify',
    './gradlew test',
    './gradle test',
    './gradlew check',
    './gradlew build',
    './gradlew --info test',
    'gradle test',
    'gradle check',
    'gradle build',
    'gradle --info -q build',
    'make test',
    'make check',
    'go test ./...',
    'cargo test',
    'dotnet test',
    'rspec spec',
    'phpunit tests',
  ])('matches %s', (cmd) => {
    expect(TEST_COMMAND.test(cmd)).toBe(true);
  });

  it.each([
    'npm test',
    'x && pytest',
    'x; pytest',
    'x | pytest',
    '(pytest)',
    'echo "pytest"',
    "echo 'jest'",
    'echo `jest`',
    '  pytest',
  ])('matches %s with a separator in front', (cmd) => {
    expect(TEST_COMMAND.test(cmd)).toBe(true);
  });

  it.each([
    'rm -rf dist',
    'echo hello',
    'docker build .',
    'npm install',
    'npm run lint',
    'npm run build',
    'npm ci',
    'yarn install',
    'pnpm run build',
    'make build',
    'make tests',
    'mvn clean',
    'mvn -B clean',
    './gradlew assemble',
    'gradle clean',
    'go build ./...',
    'cargo build',
    'dotnet build',
    'python script.py',
    'npx prettier',
    'mypytest',
    'contest',
    'jestx',
  ])('rejects %s', (cmd) => {
    expect(TEST_COMMAND.test(cmd)).toBe(false);
  });
});

describe('TEST_COMMAND known broad matches', () => {
  it.each(['npm run test-unit', 'python -m pip install pytest-cov', 'echo "run pytest now"'])('matches %s', (cmd) => {
    expect(TEST_COMMAND.test(cmd)).toBe(true);
  });
});

describe('stripYamlAndJson', () => {
  it.each([
    ['        run: pytest -q', 'pytest -q'],
    ['      - run: pytest -q', 'pytest -q'],
    ['  script: npm test', 'npm test'],
    ['  cmd: make test', 'make test'],
    ['  command: go test ./...', 'go test ./...'],
    ['  test: pytest', 'pytest'],
    ['  - pytest tests/', '  - pytest tests/'],
    ['pytest tests/', 'pytest tests/'],
    ['run:pytest', 'pytest'],
    ['run   :   pytest', 'pytest'],
    ['    "test": "jest -u",', '"jest -u'],
    ['    "test": "jest -u"', '"jest -u'],
    ['    "my script": "jest -u",', 'jest -u'],
    ['    "my script": "jest -u"', 'jest -u'],
    ['    "build:ci": "tsc && npm test",', '"tsc && npm test'],
    ['    "lint": "eslint .",', '"eslint .'],
    ['run: echo \\"a\\" b', 'echo "a" b'],
    ['run: pytest   ', 'pytest   '],
    ['', ''],
  ])('%j becomes %j', (input, expected) => {
    expect(stripYamlAndJson(input)).toBe(expected);
  });
});
