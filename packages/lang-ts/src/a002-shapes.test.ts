/**
 * A002 on the TypeScript and JavaScript shapes from the regression corpus that the v0.1 subject pairing missed, plus
 * QUnit support. Each case runs the real front end and the rule.
 */
import { describe, expect, it } from 'vitest';
import { A002 } from '@testwitness/core';
import type { ChangedFile, Finding, RuleContext } from '@testwitness/core';
import { inv, src } from './helpers.test-util.js';

async function a002(base: string, head: string, path = 'src/shape.test.ts'): Promise<Finding[]> {
  const b = await inv(src(base), path);
  const h = await inv(src(head), path);
  const changed: ChangedFile = { status: 'modified', path, kind: 'test', language: 'typescript', hunks: [], binary: false, addedLines: new Set(), removedLines: new Set() };
  const ctx = { pairs: [{ file: changed, base: b, head: h }], fingerprint: (r: string, p: string, s: string, n?: string) => `${r}:${p}:${s}:${n ?? ''}`, changedProductionFiles: new Set<string>() } as unknown as RuleContext;
  return A002.run(ctx, {});
}

const jest = (body: string) => `
  describe('shape', () => {
    it('works', async () => {
      ${body}
    });
  });
`;

describe('A002 TypeScript shapes from the corpus', () => {
  it('toBe on a trimmed value becomes toContain on the untrimmed one (letta-code#5345)', async () => {
    const out = await a002(jest('expect(result?.result?.trim()).toBe(fixture.expectedReport);'), jest('expect(result?.result).toContain(fixture.expectedReport);'));
    expect(out).toMatchObject([{ severity: 'medium', subject: 'shape › works' }]);
  });

  it('an inline snapshot of a copy with one field overridden becomes toMatchObject on a subset (wevm/ox#187)', async () => {
    const out = await a002(
      jest('expect({ ...tx, blockHash: null }).toMatchInlineSnapshot(`{ "blockHash": null, "chainId": "0x1" }`);'),
      jest("expect(tx).toMatchObject({ chainId: '0x1' });"),
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
    expect(out[0]!.message).toContain('equality (expect.toMatchInlineSnapshot)');
  });

  it('Chai lengthOf(6) becomes length greaterThan(1) (node-mongodb-native#4449)', async () => {
    const out = await a002(
      "import { expect } from 'chai';\n" + jest('expect(aggregateEvents).to.have.lengthOf(6);'),
      "import { expect } from 'chai';\n" + jest('expect(aggregateEvents.length).to.be.greaterThan(1);'),
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('a string expectation in a project request matcher becomes a regex, under describe(X.name) (aws-sdk-js-v3#8212)', async () => {
    const body = (path: string) => `
      describe('route53', () => {
        describe(Route53.name, () => {
          it('normalizes Id', async () => {
            requireRequestsFrom(client).toMatch({ path: ${path} });
            await client.getChange({ Id: '/change/x' });
            expect.hasAssertions();
          });
        });
      });
    `;
    const out = await a002(body('"/2013-04-01/change/x"'), body('/^\\/20\\d\\d-\\d\\d-\\d\\d\\/change\\/x$/'));
    expect(out).toMatchObject([{ severity: 'medium', subject: 'route53 › Route53 › normalizes Id', label: 'nested' }]);
  });

  it('a helper loosens toBe(expected) on values[0] to values.includes(expected) (next.js#52007)', async () => {
    const file = (check: string) => `
      async function checkMeta(browser, name, expected) {
        const values = await browser.eval(name);
        if (expected instanceof RegExp) {
          expect(values[0]).toMatch(expected);
        } else {
          ${check}
        }
      }
      describe('metadata', () => {
        it('has a title', async () => {
          await checkMeta(browser, 'title', 'x');
        });
      });
    `;
    const out = await a002(file('expect(values[0]).toBe(expected);'), file('expect(values.includes(expected)).toBe(expected !== undefined);'));
    expect(out).toMatchObject([{ severity: 'medium', subject: 'checkMeta', label: 'in helper' }]);
  });

  it('stays silent when the helper did not change, or got stronger', async () => {
    const file = (check: string) => `
      function checkTotal(r, expected) { ${check} }
      describe('t', () => { it('a', () => { checkTotal(r, 1); }); });
    `;
    expect(await a002(file('expect(r.total).toBe(expected);'), file('expect(r.total).toBe(expected);'))).toEqual([]);
    expect(await a002(file('expect(r.total).toBeDefined();'), file('expect(r.total).toBe(expected);'))).toEqual([]);
  });

  it('records locals bound once, through let then a single assignment', async () => {
    const i = await inv(src(jest('const names = rows.map((r) => r.id);\n      let x;\n      x = f();\n      let y = 1;\n      y = 2;\n      expect(names).toContain(x);')));
    expect(i.tests[0]!.locals).toEqual({ names: 'rows.map((r) => r.id)', x: 'f()' });
  });
});

describe('QUnit', () => {
  const qunit = (a: string, b: string) => `
    QUnit.module( "core", { afterEach: moduleTeardown } );

    QUnit.testUnlessIE( "jQuery.parseXML - error reporting", function( assert ) {
      assert.expect( 2 );
      var errorArg, lineMatch, columnMatch;
      lineMatch = errorArg.match( /line\\s*(\\d+)/ );
      columnMatch = errorArg.match( /column\\s*(\\d+)/ );
      ${a}
      ${b}
    } );

    QUnit.test( "other", function( assert ) {
      assert.ok( true );
    } );

    QUnit.module( "nested", function() {
      QUnit.skip( "skipped", function( assert ) {
        assert.equal( 1, 1 );
      } );
    } );
  `;

  it('detects QUnit tests, flat and nested modules, wrappers and skip markers', async () => {
    const i = await inv(src(qunit('assert.strictEqual( line, "1" );', 'assert.strictEqual( column, "11" );')), 'test/unit/core.js');
    expect(i.framework).toBe('qunit');
    expect(i.tests.map((t) => t.qualifiedName)).toEqual(['jQuery.parseXML - error reporting', 'other', 'nested › skipped']);
    expect(i.tests[0]!.assertions.map((a) => a.callee)).toEqual(['assert.expect', 'assert.strictEqual', 'assert.strictEqual']);
    expect(i.tests[2]!.markers.map((m) => m.kind)).toEqual(['skip']);
  });

  it('assert.strictEqual on line and column becomes assert.ok on the matches (jquery#5908)', async () => {
    const out = await a002(
      qunit('assert.strictEqual( line, "1", "reports error line" );', 'assert.strictEqual( column, "11", "reports error column" );'),
      qunit('assert.ok( lineMatch, "reports error line" );', 'assert.ok( columnMatch, "reports error column" );'),
      'test/unit/core.js',
    );
    expect(out).toMatchObject([{ severity: 'medium', subject: 'jQuery.parseXML - error reporting' }]);
  });
});

describe('A002 when the expected value itself changed', () => {
  it('reads "no value" replaced by a partial match on a new value as a new expectation, not a loosening', async () => {
    expect(await a002(jest('expect(result.failure).toBeUndefined();'), jest("expect(result.failure).toMatchObject({ kind: 'aborted' });\n      expect(result.ok).toBe(false);"))).toEqual([]);
  });

  it('still reports an exact value loosened to a partial match on the same subject', async () => {
    const out = await a002(jest("expect(result.failure).toEqual({ kind: 'aborted', at: 3 });"), jest("expect(result.failure).toMatchObject({ kind: 'aborted' });"));
    expect(out).toHaveLength(1);
  });

  it('keeps a check whose subject moved to another value paired with itself, so an unrelated equality is not called loosened', async () => {
    const base = "expect(left.err).toEqual(expected);\n      expect(right.err).toContain('hint');";
    const head = "expect(left.err).toEqual(fold(expected));\n      expect(left.err).toContain('hint');";
    expect(await a002(jest(base), jest(head))).toEqual([]);
    // Without an equality left on left.err, the equality did become a containment check.
    expect(await a002(jest(base), jest("expect(left.err).toContain('hint');"))).toHaveLength(1);
  });
});
