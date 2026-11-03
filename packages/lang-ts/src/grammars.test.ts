import { describe, expect, it } from 'vitest';
import { grammarForPath, wasmPathFor } from './grammar.js';
import { byName, inv, single, src } from './helpers.test-util.js';

describe('grammar selection', () => {
  it('maps extensions to grammars', () => {
    expect(grammarForPath('a.ts')).toBe('typescript');
    expect(grammarForPath('a.mts')).toBe('typescript');
    expect(grammarForPath('a.cts')).toBe('typescript');
    expect(grammarForPath('a.tsx')).toBe('tsx');
    expect(grammarForPath('a.js')).toBe('javascript');
    expect(grammarForPath('a.mjs')).toBe('javascript');
    expect(grammarForPath('a.cjs')).toBe('javascript');
    expect(grammarForPath('a.jsx')).toBe('javascript');
    expect(grammarForPath('a.unknown')).toBe('typescript');
  });

  it('resolves the bundled wasm files', () => {
    expect(wasmPathFor('typescript')).toMatch(/tree-sitter-typescript\.wasm$/);
    expect(wasmPathFor('tsx')).toMatch(/tree-sitter-tsx\.wasm$/);
    expect(wasmPathFor('javascript')).toMatch(/tree-sitter-javascript\.wasm$/);
  });
});

const SAMPLE = src(`
  const { describe, it, expect } = require('@jest/globals');
  jest.mock('../billing');
  function expectCharged(r) { expect(r.charged).toBe(true); }
  describe.skip('Billing', () => {
    it.each([[1], [2]])('charges %i', async (n) => {
      const r = await charge(n);
      expect(r.amount).toEqual(n);
      expect(spy).toHaveBeenCalledWith(n);
      expectCharged(r);
    });
    it('pending in js', function () { this.skip(); });
  });
`);

describe('javascript grammar', () => {
  it('produces the same inventory for a .js file', async () => {
    const inventory = await inv(SAMPLE, 'src/billing.test.js');
    expect(inventory.language).toBe('javascript');
    expect(inventory.framework).toBe('jest');
    expect(inventory.imports).toEqual(['@jest/globals']);
    expect(inventory.parseErrors).toBe(0);
    expect(inventory.assertionHelpers).toEqual(new Set(['expectCharged']));
    const t = byName(inventory, 'charges %i');
    expect(t.qualifiedName).toBe('Billing › charges %i');
    expect(t.parameterCount).toBe(2);
    expect(t.statementCount).toBe(4);
    expect(t.mocks).toEqual(['../billing']);
    expect(t.assertions.map((a) => [a.callee, a.kind])).toEqual([
      ['expect.toEqual', 'value'],
      ['expect.toHaveBeenCalledWith', 'interaction'],
      ['expectCharged', 'custom'],
    ]);
    expect(t.markers.map((m) => m.marker)).toEqual(['describe.skip']);
    expect(byName(inventory, 'pending in js').markers.map((m) => m.marker)).toEqual(['describe.skip', 'this.skip']);
  });

  it('hashes bodies identically across the ts and js grammars', async () => {
    const ts = await inv(SAMPLE, 'src/billing.test.ts');
    const js = await inv(SAMPLE, 'src/billing.test.mjs');
    expect(js.tests.map((t) => t.bodyHash)).toEqual(ts.tests.map((t) => t.bodyHash));
    expect(js.tests.map((t) => t.statementCount)).toEqual(ts.tests.map((t) => t.statementCount));
  });

  it('parses jsx test files with the javascript grammar', async () => {
    const t = await single(src(`
      import { render, screen } from '@testing-library/react';
      test('renders', () => {
        render(<App title="x" />);
        expect(screen.getByText('x')).toBeInTheDocument();
      });
    `), 'src/App.test.jsx');
    expect(t.statementCount).toBe(2);
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.toBeInTheDocument']);
    expect(t.assertions[0]!.family).toBeUndefined();
  });
});

describe('tsx grammar', () => {
  it('parses tsx with generics and jsx in a test body', async () => {
    const inventory = await inv(src(`
      import { describe, it, expect, vi } from 'vitest';
      describe('<Button />', () => {
        it('calls onClick', () => {
          const onClick = vi.fn<[], void>();
          render(<Button onClick={onClick}>Go</Button>);
          fireEvent.click(screen.getByRole('button'));
          expect(onClick).toHaveBeenCalledTimes(1);
        });
      });
    `), 'src/Button.test.tsx');
    expect(inventory.language).toBe('typescript');
    expect(inventory.parseErrors).toBe(0);
    const t = inventory.tests[0]!;
    expect(t.qualifiedName).toBe('<Button /> › calls onClick');
    expect(t.statementCount).toBe(4);
    expect(t.assertions.map((a) => a.callee)).toEqual(['expect.toHaveBeenCalledTimes']);
  });

  it('handles typescript specific syntax around assertions', async () => {
    const t = await single(src(`
      test('ts syntax', async () => {
        const v = load() as Result;
        expect(v!.value).toBe(1 as number);
        expect((v satisfies Result).ok).toBeTruthy();
        expect<number>(v.n).toBe(2);
        (expect(v) as any).toBe(v);
      });
    `));
    expect(t.statementCount).toBe(5);
    expect(t.assertions.map((a) => [a.callee, a.subject])).toEqual([
      ['expect.toBe', 'v!.value'],
      ['expect.toBeTruthy', '(v satisfies Result).ok'],
      ['expect.toBe', 'v.n'],
      ['expect.toBe', 'v'],
    ]);
  });
});
