import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { inventoryKeys } from '@testwitness/core';
import { emptyIndex, finaliseTotals, readResultsFiles, toEvidence } from './reader.js';
import { looksLikeFile, parseTap, readTapStream, splitDescription, TAP_MAX_LINE } from './tap.js';
const TIMING_OFF = process.env['TESTWITNESS_TIMING'] === 'off'; // Stryker instruments the code under test, so wall clock budgets do not apply there

// Every sample below is real output; fixtures/ts-node-test/results/*/PRODUCER.md has the versions and commands.
const RESULTS = join(import.meta.dirname, '../../../fixtures/ts-node-test/results');
const NODE = join(RESULTS, 'tap/results.tap');
const NODE_TAP = join(RESULTS, 'tap-node-tap/results.tap');
const PERL = join(RESULTS, 'tap-perl/text.tap');
const PERL_BAIL = join(RESULTS, 'tap-perl/bail.tap');

const chains = (text: string) => parseTap(text).records.map((r) => `${r.status} ${r.chain.join(' › ')}`);

describe('TAP from Node 22 (node --test --test-reporter=tap)', () => {
  const text = readFileSync(NODE, 'utf8');

  it('reads every test, not the describe blocks, by the YAML type', () => {
    expect(chains(text).sort()).toEqual(
      [
        'passed counts with a plan',
        'skipped skipped with a reason',
        'skipped todo that fails',
        'passed Text › slugify › lowercases and joins with dashes',
        'passed Text › slugify › strips leading and trailing separators',
        'skipped Text › slugify › handles unicode',
        'skipped Text › slugify › keeps numbers',
        'failed Text › slugify › fails on purpose',
        'passed Numbers › clamps below the range',
        'passed Numbers › clamps above the range',
        'passed clamp table',
        'passed clamp table › inside the range',
        'passed clamp table › at the edge',
      ].sort(),
    );
  });

  it('matches the runner summary (tests 13, pass 8, fail 1, skipped 2, todo 2) and honours the plan', async () => {
    const s = parseTap(text);
    expect(s.version).toBe(13);
    expect(s.plan).toBe(6);
    expect(s.points).toBe(6);
    expect(s.warnings).toEqual([]);
    const d = await readResultsFiles([NODE]);
    expect(d.totals).toEqual({ total: 13, passed: 8, failed: 1, errored: 0, skipped: 4, flaky: 0 });
    expect([...d.formats]).toEqual(['tap']);
  });

  it('keys a test with no file subtest by its chain on both sides, which the inventory of the test file produces', async () => {
    const e = toEvidence(await readResultsFiles([NODE]));
    const key = 'text slugify lowercases and joins with dashes::text slugify lowercases and joins with dashes';
    expect(e.has(key)).toBe(true);
    expect(inventoryKeys('test/text.test.js', 'Text › slugify › lowercases and joins with dashes', 'javascript')).toContain(key);
    expect(inventoryKeys('test/extras.test.js', 'counts with a plan', 'javascript')).toContain('counts with a plan::counts with a plan');
  });

  it('reads a todo that fails as skipped, not failed (TAP TODO semantics)', () => {
    expect(parseTap(text).records.find((r) => r.chain[0] === 'todo that fails')?.status).toBe('skipped');
  });
});

describe('TAP 14 from node-tap 21 (tap --reporter=tap)', () => {
  const text = readFileSync(NODE_TAP, 'utf8');

  it('takes the innermost subtests as tests and their leaf points as assertions', () => {
    expect(chains(text).sort()).toEqual(
      [
        'passed test/text.test.js › Text › slugify › lowercases and joins with dashes',
        'skipped test/text.test.js › Text › slugify › handles unicode',
        'skipped test/text.test.js › Text › slugify › keeps numbers',
        'failed test/text.test.js › Text › slugify › fails on purpose',
        'passed test/text.test.js › Numbers › clamps below the range',
      ].sort(),
    );
    const s = parseTap(text);
    expect(s.version).toBe(14);
    expect(s.plan).toBe(1);
    expect(s.points).toBe(1);
  });

  it('uses the file subtest as the class, the Vitest and Playwright shape', async () => {
    const d = await readResultsFiles([NODE_TAP]);
    expect(d.totals).toEqual({ total: 5, passed: 2, failed: 1, errored: 0, skipped: 2, flaky: 0 });
    const rec = d.records.get('text::text slugify lowercases and joins with dashes');
    expect(rec?.file).toBe('test/text.test.js');
    expect(inventoryKeys('test/text.test.js', 'Text › slugify › lowercases and joins with dashes', 'javascript')).toContain(rec!.key);
  });

  it('ignores the trailing # time= comment of a point', () => {
    expect(parseTap(text).records.every((r) => !r.chain.some((c) => c.includes('time=')))).toBe(true);
  });
});

describe('TAP from Perl Test::More 1.302194', () => {
  it('reads plain points, SKIP without a description, TODO, and a subtest as one test', () => {
    expect(chains(readFileSync(PERL, 'utf8')).sort()).toEqual(
      ['passed lowercases and joins with dashes', 'passed strips leading and trailing separators', 'skipped #3', 'skipped keeps numbers', 'failed fails on purpose', 'passed clamp table'].sort(),
    );
    expect(parseTap(readFileSync(PERL, 'utf8')).warnings).toEqual([]);
  });

  it('stops at Bail out! with a warning and keeps the points before it', async () => {
    const s = parseTap(readFileSync(PERL_BAIL, 'utf8'));
    expect(s.bailedOut).toBe('fixture database is gone');
    expect(s.records.map((r) => r.chain.join())).toEqual(['connects to the fixture database']);
    const d = await readResultsFiles([PERL_BAIL]);
    expect(d.warnings.some((w) => /bailed out: fixture database is gone/.test(w))).toBe(true);
    expect(d.totals.total).toBe(1);
  });
});

describe('TAP details', () => {
  it('splits descriptions at the first unescaped # and reads directives case insensitively', () => {
    expect(splitDescription('adds \\# signs # SKIP no db')).toEqual({ name: 'adds # signs', directive: 'skip' });
    expect(splitDescription('a # skipped on windows')).toEqual({ name: 'a', directive: 'skip' });
    expect(splitDescription('a # Todo later')).toEqual({ name: 'a', directive: 'todo' });
    expect(splitDescription('a # time=1ms')).toEqual({ name: 'a' });
    expect(splitDescription('back\\\\slash')).toEqual({ name: 'back\\slash' });
  });

  it('tells a file subtest from a describe title', () => {
    expect(looksLikeFile('test/text.test.js')).toBe(true);
    expect(looksLikeFile('t/basic.t')).toBe(true);
    expect(looksLikeFile('Text')).toBe(false);
    expect(looksLikeFile('handles a/b paths')).toBe(false);
  });

  it('warns when the plan and the points disagree, or there is no plan', () => {
    expect(parseTap('1..3\nok 1 - a\nok 2 - b\n').warnings).toEqual(['plan 1..3 but 2 test points']);
    expect(parseTap('ok 1 - a\n').warnings).toEqual(['no plan line; 1 test points read']);
    expect(parseTap('1..0 # SKIP nothing here\n').warnings).toEqual([]);
  });

  it('names a TAP 14 subtest from a heading indented inside its block', () => {
    const s = parseTap(['TAP version 14', '    # Subtest: outer', '    ok 1 - inner', '    1..1', 'ok 1 - outer', '1..1'].join('\n'));
    expect(s.records.map((r) => `${r.status} ${r.chain.join(' › ')}`)).toEqual(['passed outer']);
  });

  it('keeps the records of a subtest left open by the end of input', () => {
    const s = parseTap(['1..1', '# Subtest: never closed', '    ok 1 - a', '    ok 2 - b'].join('\n'));
    expect(s.records.map((r) => r.chain.join(' › '))).toEqual(['never closed › a', 'never closed › b']);
  });

  it('streams buffers whose chunks split lines and multibyte characters', async () => {
    const bytes = Buffer.from('TAP version 13\n1..2\nok 1 - Billing › charge\nnot ok 2 - café\n', 'utf8');
    const cuts = [5, bytes.indexOf(Buffer.from('›')) + 1, bytes.indexOf(Buffer.from('é')) + 1];
    const parts = [bytes.subarray(0, cuts[0]), bytes.subarray(cuts[0], cuts[1]), bytes.subarray(cuts[1], cuts[2]), bytes.subarray(cuts[2])];
    const data = emptyIndex();
    await readTapStream(Readable.from(parts), 'split.tap', data);
    finaliseTotals(data);
    expect([...data.records.values()].map((r) => `${r.status} ${r.name}`)).toEqual(['passed Billing › charge', 'failed café']);
    expect(data.warnings).toEqual([]);
  });

  it('skips a line over the cap with a warning and reads the rest', async () => {
    const data = emptyIndex();
    const long = 'x'.repeat(TAP_MAX_LINE + 10);
    await readTapStream(Readable.from(['1..2\nok 1 - a\n# ', long.slice(0, TAP_MAX_LINE / 2), long, '\nok 2 - b\n']), 'long.tap', data);
    expect([...data.records.values()].map((r) => r.name)).toEqual(['a', 'b']);
    expect(data.warnings.some((w) => /1 line over 1024 KB skipped/.test(w))).toBe(true);
  });
});

describe('TAP parser properties', () => {
  const status = fc.constantFrom('ok', 'not ok', 'ok # SKIP', 'not ok # TODO');

  it('never throws on arbitrary lines', () => {
    const tapish = fc.oneof(
      fc.string(),
      fc.constantFrom('TAP version 14', '1..3', '---', '...', 'Bail out!', '# Subtest: x', '# Subtest', 'ok', 'not ok 1 -', 'ok 1 - a # SKIP', '  type: test', '\t\tok 2'),
      fc.tuple(fc.nat(12), fc.constantFrom('ok 1 - a', 'not ok 2 - b', '# Subtest: c', '1..2', '---', '...', 'type: \'suite\'')).map(([n, l]) => ' '.repeat(n) + l),
    );
    fc.assert(
      fc.property(fc.array(tapish, { maxLength: 60 }), (lines) => {
        const s = parseTap(lines.join('\n'));
        const pointLines = lines.filter((l) => /^\s*(not )?ok\b/i.test(l)).length;
        expect(s.records.length).toBeLessThanOrEqual(pointLines);
        for (const r of s.records) expect(['passed', 'failed', 'skipped']).toContain(r.status);
      }),
      { numRuns: 500 },
    );
  });

  it('reads as many tests as the plan says when the plan is honoured', () => {
    fc.assert(
      fc.property(fc.array(status, { maxLength: 40 }), fc.boolean(), (statuses, planFirst) => {
        const points = statuses.map((s, i) => {
          const [word, directive] = s.split(' # ');
          return `${word} ${i + 1} - test ${i + 1}${directive ? ` # ${directive}` : ''}`;
        });
        const plan = `1..${statuses.length}`;
        const s = parseTap(['TAP version 14', ...(planFirst ? [plan] : []), ...points, ...(planFirst ? [] : [plan])].join('\n'));
        expect(s.plan).toBe(statuses.length);
        expect(s.points).toBe(statuses.length);
        expect(s.records.length).toBe(statuses.length);
        expect(s.warnings).toEqual([]);
        expect(s.records.filter((r) => r.status === 'failed').length).toBe(statuses.filter((x) => x === 'not ok').length);
        expect(s.records.filter((r) => r.status === 'skipped').length).toBe(statuses.filter((x) => x.includes('#')).length);
      }),
    );
  });

  it('reads one record per Node test in any nesting of suites and tests', () => {
    interface Node { name: string; type: 'test' | 'suite'; children: Node[] }
    const tree: fc.Memo<Node> = fc.memo((depth) =>
      fc.record({
        name: fc.stringMatching(/^[a-z][a-z ]{0,8}[a-z]$/),
        type: fc.constantFrom('test' as const, 'suite' as const),
        children: depth > 1 ? fc.array(tree(depth - 1), { maxLength: 3 }) : fc.constant([]),
      }),
    );
    const render = (nodes: Node[], level: number): string[] => {
      const pad = '    '.repeat(level);
      const out: string[] = [];
      nodes.forEach((n, i) => {
        out.push(`${pad}# Subtest: ${n.name}`);
        if (n.children.length) out.push(...render(n.children, level + 1), `${pad}    1..${n.children.length}`);
        out.push(`${pad}ok ${i + 1} - ${n.name}`, `${pad}  ---`, `${pad}  duration_ms: 0.1`, `${pad}  type: '${n.type}'`, `${pad}  ...`);
      });
      return out;
    };
    const count = (nodes: Node[]): number => nodes.reduce((n, x) => n + (x.type === 'test' ? 1 : 0) + count(x.children), 0);
    fc.assert(
      fc.property(fc.array(tree(3), { maxLength: 4 }), (nodes) => {
        const s = parseTap(['TAP version 13', ...render(nodes, 0), `1..${nodes.length}`].join('\n'));
        expect(s.records.length).toBe(count(nodes));
        expect(s.points).toBe(nodes.length);
      }),
    );
  });
});

describe('TAP on hostile input (review regression)', () => {
  it.skipIf(TIMING_OFF)('reads a line with a long run of inner spaces in linear time', () => {
    // indentOf used /\s+$/, which took 8 s on this 100 kB line and grows with the square of its length.
    const line = `ok 1 - a${' '.repeat(100_000)}b`;
    const t0 = performance.now();
    const s = parseTap(`TAP version 14\n${line}\n${line}\n1..2\n`);
    expect(performance.now() - t0).toBeLessThan(TIMING_OFF ? Number.POSITIVE_INFINITY : 2000);
    expect(s.points).toBe(2);
    expect(s.records[0]!.chain[0]).toMatch(/^a +b$/);
  });
});

describe('TAP written on Windows (CRLF)', () => {
  it('reads the same records from CRLF as from LF, the YAML blocks included', () => {
    for (const file of [NODE, NODE_TAP, PERL]) {
      const text = readFileSync(file, 'utf8');
      expect(parseTap(text.replace(/\n/g, '\r\n')), file).toEqual(parseTap(text));
    }
  });

  it('streams CRLF TAP split across chunks at the CR', async () => {
    const text = readFileSync(NODE, 'utf8');
    const crlf = text.replace(/\n/g, '\r\n');
    const at = crlf.indexOf('\r\n', 200) + 1;
    const lf = emptyIndex();
    await readTapStream(Readable.from([text]), 'a.tap', lf);
    const split = emptyIndex();
    await readTapStream(Readable.from([crlf.slice(0, at), crlf.slice(at)]), 'a.tap', split);
    finaliseTotals(lf);
    finaliseTotals(split);
    expect([...split.records.values()].map((r) => `${r.status} ${r.name}`)).toEqual([...lf.records.values()].map((r) => `${r.status} ${r.name}`));
    expect(split.records.size).toBeGreaterThan(5);
    expect(split.warnings).toEqual(lf.warnings);
  });
});
