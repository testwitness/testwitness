/**
 * A002 on the Python shapes from the regression corpus that the v0.1 subject pairing missed, plus the controls that
 * keep the new pairing honest. Each case runs the real front end and the rule.
 */
import { describe, expect, it } from 'vitest';
import { A002 } from '@testwitness/core';
import type { ChangedFile, Finding, FrameworkProfile, RuleContext } from '@testwitness/core';
import { pythonFrontEnd } from './index.js';

const profile: FrameworkProfile = { frameworks: new Set(), extraAssertions: [] };
const PATH = 'tests/test_shape.py';

function file(body: string): string {
  return `import re\n\nimport pytest\n\n\ndef test_shape():\n${body}\n`;
}

async function a002(base: string, head: string, wrap = true): Promise<Finding[]> {
  const b = await pythonFrontEnd.inventory(PATH, wrap ? file(base) : base, profile);
  const h = await pythonFrontEnd.inventory(PATH, wrap ? file(head) : head, profile);
  const changed: ChangedFile = { status: 'modified', path: PATH, kind: 'test', language: 'python', hunks: [], binary: false, addedLines: new Set(), removedLines: new Set() };
  const ctx = { pairs: [{ file: changed, base: b, head: h }], fingerprint: (r: string, p: string, s: string, n?: string) => `${r}:${p}:${s}:${n ?? ''}`, changedProductionFiles: new Set<string>() } as unknown as RuleContext;
  return A002.run(ctx, {});
}

describe('A002 Python shapes from the corpus', () => {
  it('dict equality becomes a per key subset with all(...) (mlflow#21066)', async () => {
    const out = await a002(
      '    assert root_span.inputs == {"kwargs": {"inputs": ["a", "b"]}}',
      '    expected_inputs = {"kwargs": {"inputs": ["a", "b"]}}\n    assert all(root_span.inputs.get(k) == v for k, v in expected_inputs.items())',
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
    expect(out[0]!.message).toContain('containment');
  });

  it('a count equality becomes membership in a comprehension over the same list (python-aiplatform#1040)', async () => {
    const out = await a002('    assert len(list_entity_types) == 2', '    assert get_entity.resource_name in [\n        e.resource_name for e in list_entity_types\n    ]');
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('follows a local bound once to a comprehension, and reports one finding for several loosened pairs', async () => {
    const out = await a002(
      '    assert len(features) == 0\n    create()\n    assert len(features) == 3',
      '    create()\n    names = [f.resource_name for f in features]\n    assert a.resource_name in names\n    assert b.resource_name in names\n    assert c.resource_name in names',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('1 more assertion was loosened');
  });

  it('pairs by position when the leftovers match one for one and share an identifier word', async () => {
    const out = await a002(
      '    assert (len(list_featurestores) - base_count) == 1',
      '    assert get_featurestore.resource_name in [\n        f.resource_name for f in list_featurestores\n    ]',
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('does not pair by position when the leftovers differ in number', async () => {
    expect(await a002('    assert shared["base"] is not None\n    assert (len(found) - shared["base"]) == 6', '    assert len(found) >= 1')).toEqual([]);
  });

  it('PyHamcrest has_items loosens to has_item(contains_string(...)) inside a project matcher (beam#11795)', async () => {
    const base = `from apache_beam.testing.util import assert_that\nimport hamcrest as hc\n\n\ndef test_labels():\n    assert_that(output, matches_all([hc.has_items('bicycle', 'dinosaur')]))\n`;
    const head = `from apache_beam.testing.util import assert_that\nimport hamcrest as hc\n\n\ndef test_labels():\n    assert_that(\n        output,\n        matches_all([hc.has_item(hc.contains_string('bicycle'))]),\n    )\n`;
    const out = await a002(base, head, false);
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('keeps the v0.1 grading inside one library family: == 12 to < 15 is high (langchain#31319)', async () => {
    const out = await a002('    assert llm_streams == 12', '    assert llm_streams < 15');
    expect(out.map((f) => f.severity)).toEqual(['high']);
  });

  it('set equality becomes per element membership in a loop (langchain#37612)', async () => {
    const out = await a002(
      '    assert content_types == {"call", "result", "text"}',
      '    for expected in ("call", "result", "text"):\n        assert expected in content_types, f"missing {expected!r}"',
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('reads a swapped literal as the same strength (3 == len(x) is len(x) == 3)', async () => {
    expect(await a002('    assert len(items) == 3', '    assert 3 == len(items)')).toEqual([]);
  });

  it('stays silent on a stronger head, an unrelated subject, and a negative check', async () => {
    expect(await a002('    assert "x" in body', '    assert body == "x"')).toEqual([]);
    expect(await a002('    assert receipt.total() == 1250', '    assert customer() is not None')).toEqual([]);
    expect(await a002('    assert "x" in body', '    assert "x" not in body')).toEqual([]);
  });

  it('records the comparison operator, the locals and the helper assertions', async () => {
    const inv = await pythonFrontEnd.inventory(PATH, `def _check(x):\n    assert x == 1\n\n\ndef test_a():\n    names = [r.id for r in rows]\n    n = 1\n    n += 1\n    assert 3 <= len(names)\n    assert "a" not in names\n`, profile);
    const t = inv.tests[0]!;
    expect(t.assertions.map((a) => a.matcher)).toEqual(['>=', 'not in']);
    expect(t.locals).toEqual({ names: '[r.id for r in rows]' });
    expect(Object.keys(inv.helperAssertions ?? {})).toEqual(['_check']);
  });
});
