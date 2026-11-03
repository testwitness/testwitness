import { describe, expect, it } from 'vitest';
import type { ChangedFile, FileKind } from '../types.js';
import { S004, W003 } from './W.js';
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
