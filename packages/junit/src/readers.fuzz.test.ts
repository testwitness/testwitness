// Fuzz: the results readers (JUnit XML, TAP, and the JSON of Jest, Vitest, pytest-json-report and Playwright). A
// results file is written by the pull request's own test run, so every byte of it is untrusted
// (docs/threat-model.md, "Oversized or malicious XML and JSON").
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fuzz, hostileText, mutated, TARGET_TIMEOUT_MS } from '../../../fuzz/kit.js';
import { XML_MAX_ERRORS } from '@testwitness/core';
import { readJunitString, readResultsString } from './reader.js';
import { readJsonResults } from './json.js';
import { emptyIndex, finaliseTotals, type ResultIndexData } from './records.js';
import { parseTap } from './tap.js';

const JUNIT = [
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="com.acme.MathTest" tests="3" time="0.12">\n<testcase classname="com.acme.MathTest" name="adds" time="0.01"/>\n<testcase classname="com.acme.MathTest" name="fails" file="src/MathTest.java"><failure message="boom">trace &lt;here&gt;</failure></testcase>\n<testcase classname="com.acme.MathTest" name="skips"><skipped/></testcase>\n<testcase name="flaky[1]"><flakyFailure/><system-out><![CDATA[out]]></system-out></testcase>\n</testsuite></testsuites>\n',
  '<testsuite name="pytest"><testcase classname="tests.test_x.TestK" name="test_a[p-1]" time="1e-3"/><testcase classname="tests.test_x" name="test_b"><error/></testcase><testcase name="r"><rerunFailure/><rerunError/></testcase></testsuite>',
];
const TAP = [
  'TAP version 14\n1..3\nok 1 - adds\nnot ok 2 - fails\n  ---\n  message: boom\n  ...\nok 3 - skips # SKIP not today\n',
  "TAP version 13\n# Subtest: test/a.test.js\n    # Subtest: math\n        ok 1 - adds\n          ---\n          duration_ms: 0.1\n          type: 'test'\n          ...\n        1..1\n    ok 1 - math\n      ---\n      type: 'suite'\n      ...\n    1..1\nok 1 - test/a.test.js\n1..1\nBail out! stop\n",
];
const JEST = ['{"numRuntimeErrorTestSuites":0,"testResults":[{"name":"/r/src/a.test.ts","status":"passed","assertionResults":[{"ancestorTitles":["math"],"title":"adds","fullName":"math adds","status":"passed","duration":3,"failureMessages":[],"invocations":1},{"ancestorTitles":[],"title":"skips","status":"pending"},{"title":"fails","status":"failed","failureMessages":["x","y"]}]},{"name":"/r/src/b.test.ts","status":"failed","message":"SyntaxError","assertionResults":[]}]}'];
const VITEST = ['{"numTotalTests":2,"testResults":[{"name":"/r/src/a.test.ts","status":"passed","assertionResults":[{"ancestorTitles":["math"],"title":"adds","status":"passed","duration":1.5,"failureMessages":[]},{"ancestorTitles":["math"],"title":"retried","status":"passed","failureMessages":["first"]}]}]}'];
const PYTEST = ['{"created":1.0,"summary":{"collected":3,"passed":1},"collectors":[{"nodeid":"tests/test_bad.py","outcome":"failed"}],"tests":[{"nodeid":"tests/test_x.py::TestK::test_a[p]","outcome":"passed","call":{"duration":0.01,"outcome":"passed"}},{"nodeid":"tests/test_x.py::test_b","outcome":"rerun","setup":{"outcome":"passed"},"call":{"outcome":"passed"}},{"nodeid":"tests/test_x.py::test_c","outcome":"xfailed"}]}'];
const PLAYWRIGHT = ['{"config":{"projects":[]},"stats":{"expected":1},"errors":[{"message":"\\u001b[31mglobal\\u001b[39m\\nmore"}],"suites":[{"title":"a.spec.ts","file":"a.spec.ts","specs":[{"title":"top","file":"a.spec.ts","tests":[{"status":"expected","expectedStatus":"passed","results":[{"status":"passed","duration":5}]}]}],"suites":[{"title":"group","specs":[{"title":"flaky","tests":[{"results":[{"status":"failed","duration":1},{"status":"passed","duration":1}]}]},{"title":"gone","tests":[{"status":"unexpected","results":[{"status":"interrupted"}]}]}]}]}]}'];

/** What every reader must leave behind, whatever it was given. */
function wellFormed(data: ResultIndexData): void {
  expect(data.totals.total).toBe(data.records.size);
  expect(data.totals.passed + data.totals.failed + data.totals.errored + data.totals.skipped).toBe(data.totals.total);
  for (const [key, r] of data.records) {
    expect(r.key).toBe(key);
    expect(['passed', 'failed', 'error', 'skipped', 'flaky']).toContain(r.status);
    expect(Number.isInteger(r.reruns) && r.reruns >= 0, `reruns ${r.reruns}`).toBe(true);
    if (r.timeMs !== undefined) expect(Number.isFinite(r.timeMs), `timeMs ${r.timeMs}`).toBe(true);
  }
  expect(data.warnings.every((w) => typeof w === 'string')).toBe(true);
}

/** JSON values with the keys and words the readers look at, so the generator reaches their branches. */
const KEYS = ['testResults', 'assertionResults', 'ancestorTitles', 'title', 'fullName', 'status', 'failureMessages', 'invocations', 'duration', 'name', 'testFilePath', 'message', 'failureMessage', 'tests', 'summary', 'collectors', 'nodeid', 'outcome', 'setup', 'call', 'teardown', 'suites', 'specs', 'config', 'stats', 'errors', 'results', 'expectedStatus', 'file', 'numRuntimeErrorTestSuites', '__proto__', 'constructor', 'toString', 'length'];
const WORDS = ['passed', 'failed', 'pending', 'skipped', 'todo', 'disabled', 'focused', 'error', 'xfailed', 'xpassed', 'rerun', 'expected', 'unexpected', 'flaky', 'interrupted', 'timedOut', 'a.py::T::t[x]', '::', 'a::'];
const shaped: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', maxDepth: 6 },
    fc.constantFrom(...WORDS),
    hostileText(2),
    fc.double(),
    fc.constantFrom(null, true, false, 0, -1, 1e308, Number.MAX_SAFE_INTEGER),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.constantFrom(...KEYS), tie('value'), { maxKeys: 6 }),
  ),
})).value;

describe('fuzz: results readers', () => {
  it('JUnit XML: never rejects, totals add up, XML errors are capped', async () => {
    await fuzz('junit xml reader', mutated(JUNIT), async (xml) => {
      const data = await readJunitString(xml, 's.xml');
      wellFormed(data);
      expect(data.warnings.length).toBeLessThanOrEqual(XML_MAX_ERRORS + 2);
    });
  }, TARGET_TIMEOUT_MS);

  it('TAP: never throws, every record has a status and a name path', async () => {
    await fuzz('tap reader', mutated(TAP), async (text) => {
      const summary = parseTap(text);
      for (const r of summary.records) expect(['passed', 'failed', 'skipped']).toContain(r.status);
      wellFormed(await readResultsString(text.startsWith('TAP') ? text : `TAP version 14\n${text}`, 's.tap'));
    });
  }, TARGET_TIMEOUT_MS);

  for (const [name, seeds] of [['jest json reader', JEST], ['vitest json reader', VITEST], ['pytest json-report reader', PYTEST], ['playwright json reader', PLAYWRIGHT]] as const) {
    it(`${name}: damaged documents never reject and never break the totals`, async () => {
      await fuzz(name, mutated(seeds), async (text) => wellFormed(await readResultsString(text, 's.json')));
    }, TARGET_TIMEOUT_MS);
  }

  it('JSON readers: any JSON value with the readers\' own keys is read without a throw', async () => {
    await fuzz('json readers, shaped values', fc.tuple(fc.constantFrom('jest', 'pytest', 'playwright', 'any'), shaped, shaped), ([kind, a, b]) => {
      const doc = kind === 'jest' ? { numRuntimeErrorTestSuites: 0, testResults: [a, b, { name: b, assertionResults: [a, b] }] } : kind === 'pytest' ? { summary: {}, collectors: a, tests: [a, b, { nodeid: 'a.py::t', outcome: a, call: b }] } : kind === 'playwright' ? { config: {}, stats: {}, errors: [a], suites: [a, { title: b, specs: [{ title: a, tests: [b, { status: a, results: b }] }], suites: [a, b] }] } : a;
      const data = emptyIndex();
      readJsonResults(JSON.parse(JSON.stringify(doc)), 's.json', data);
      finaliseTotals(data);
      wellFormed(data);
    });
  }, TARGET_TIMEOUT_MS);
});

describe('regression: hostile results files', () => {
  it('entity expansion and external entities are not resolved', async () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]><testsuite name="s"><testcase classname="&xxe;" name="&lol3;"/></testsuite>';
    const data = await readJunitString(xml);
    expect([...data.records.values()].map((r) => [r.classname, r.name])).toEqual([['&xxe;', '&lol3;']]);
    expect(JSON.stringify([...data.records.values()])).not.toContain('root:');
  });

  it('a file with one XML error every few bytes gives a handful of notes, not one per error', async () => {
    // 900 kB of undefined entities gave 300,000 warnings (8.7 MB); at the 500 MB results cap that exhausted memory.
    for (const body of ['&x;'.repeat(100_000), '< '.repeat(100_000), '<a b>'.repeat(60_000)]) {
      const data = await readJunitString(`<testsuite>${body}</testsuite>`, 'big.xml');
      expect(data.warnings.length).toBeLessThanOrEqual(XML_MAX_ERRORS + 2);
      expect(data.warnings.join('\n')).toMatch(/\d+ more XML errors/);
    }
  }, 60_000);

  it('deep nesting, a huge attribute and a huge number are read without a crash', async () => {
    const deep = `<testsuite><testcase name="x">${'<a>'.repeat(100_000)}${'</a>'.repeat(100_000)}</testcase></testsuite>`;
    expect((await readJunitString(deep)).records.size).toBe(1);
    const huge = await readJunitString(`<testsuite><testcase classname="C" name="${'n'.repeat(5_000_000)}" time="1e999"/><testcase classname="C" name="neg" time="-5"/><testcase classname="C" name="big" time="${'9'.repeat(400)}"/></testsuite>`);
    expect(huge.records.size).toBe(3);
    for (const r of huge.records.values()) expect(r.timeMs).toBeUndefined();
  }, 60_000);

  it('JSON nested too deep to parse is a note, and deep Playwright suites stop at the cap', async () => {
    const data = await readResultsString(`{"suites":${'['.repeat(200_000)}${']'.repeat(200_000)},"config":{},"stats":{}}`, 'deep.json');
    expect(data.records.size).toBe(0);
    expect(data.warnings.join('\n')).toMatch(/not valid JSON|no test results/);
    let suite: Record<string, unknown> = { title: 'leaf', specs: [{ title: 't', tests: [{ status: 'expected', results: [] }] }] };
    for (let i = 0; i < 3000; i++) suite = { title: 'd', suites: [suite] };
    const pw = emptyIndex();
    readJsonResults({ config: {}, stats: {}, suites: [suite] }, 'pw.json', pw);
    expect(pw.warnings.join('\n')).toMatch(/nested deeper than/);
  }, 60_000);

  it('a TAP line of spaces with a line separator in it is read in linear time', () => {
    // POINT, PLAN, SUBTEST and BAIL each retried their whitespace runs from every length when `(.*)$` met U+2028.
    for (const line of [`ok${' '.repeat(100_000)}a\u2028b`, `1..2 #${' '.repeat(100_000)}a\u2028b`, `# Subtest:${' '.repeat(100_000)}a\u2028b`, `Bail out!${' '.repeat(100_000)}a\u2028b`]) {
      const t0 = performance.now();
      parseTap(`TAP version 14\n${line}\n`);
      expect(performance.now() - t0, line.slice(0, 12)).toBeLessThan(2000);
    }
  });

  it('a fractional or absurd invocation count is not read as reruns', async () => {
    const data = await readResultsString('{"numRuntimeErrorTestSuites":0,"testResults":[{"name":"a.test.ts","assertionResults":[{"title":"t","status":"passed","invocations":2.5},{"title":"u","status":"failed","invocations":1e308}]}]}');
    wellFormed(data);
    expect([...data.records.values()].map((r) => r.reruns)).toEqual([0, 0]);
  });

  it('hostile names are kept as data', async () => {
    const data = await readResultsString(`<testsuite><testcase classname="A" name="x&#10;::error::forged &#x202e; @octocat"/></testsuite>`);
    expect([...data.records.values()][0]!.name).toContain('::error::forged');
  });
});
