/**
 * A002 on the Java shapes from the regression corpus that the v0.1 subject pairing missed. Each case builds base and
 * head inventories with the real front end and runs the rule, so the front end and the lattice are checked together.
 */
import { describe, expect, it } from 'vitest';
import { A002 } from '@testwitness/core';
import type { ChangedFile, Finding, FrameworkProfile, RuleContext } from '@testwitness/core';
import { javaFrontEnd } from './index.js';

const profile: FrameworkProfile = { frameworks: new Set(), extraAssertions: [] };
const PATH = 'src/test/java/com/acme/ShapeTest.java';

function file(body: string, imports = ''): string {
  return `package com.acme;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
${imports}
class ShapeTest {
  @Test
  void shape() {
${body}
  }
}
`;
}

async function a002(base: string, head: string, imports = ''): Promise<Finding[]> {
  const b = await javaFrontEnd.inventory(PATH, file(base, imports), profile);
  const h = await javaFrontEnd.inventory(PATH, file(head, imports), profile);
  const changed: ChangedFile = { status: 'modified', path: PATH, kind: 'test', language: 'java', hunks: [], binary: false, addedLines: new Set(), removedLines: new Set() };
  const ctx = { pairs: [{ file: changed, base: b, head: h }], fingerprint: (r: string, p: string, s: string, n?: string) => `${r}:${p}:${s}:${n ?? ''}`, changedProductionFiles: new Set<string>() } as unknown as RuleContext;
  return A002.run(ctx, {});
}

describe('A002 Java shapes from the corpus', () => {
  it('assertEquals in a lambda becomes assertTrue(header.contains(x)) (micronaut-core#9308)', async () => {
    const out = await a002(
      '    Object a = builder().assertResponse(response -> {\n      assertEquals("application/json+feed", response.header("Content-Type"));\n    }).build();',
      '    Object a = builder().assertResponse(response -> assertTrue(response.header("Content-Type").contains(FEED))).build();',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'medium', subject: 'ShapeTest#shape' });
    expect(out[0]!.after).toBe('assertTrue(response.header("Content-Type").contains(FEED))');
    expect(out[0]!.message).toContain('equality (assertEquals)');
    expect(out[0]!.message).toContain('containment (assertTrue)');
  });

  it('a whole body equality becomes containment on a local normalised copy (micronaut-core#12499)', async () => {
    const out = await a002(
      '    assertTrue(bodyOptional.isPresent());\n    assertEquals("{\\"message\\":\\"Bad Request\\"}", bodyOptional.get());',
      '    assertTrue(bodyOptional.isPresent());\n    String normalizedBody = bodyOptional.get().replace("\\\\n", "").replace("\\n", "");\n    assertTrue(normalizedBody.contains(MESSAGE), "should contain the message");',
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('assertEquals(size >= n, true) becomes assertTrue(size > 0) (pulsar#25716)', async () => {
    const imports = '';
    const out = await a002(
      '    assertEquals(lowSeen.size() >= total - queue * 2 - 1, true, "must see overflow");',
      '    assertTrue(lowSeen.size() > 0, "must see overflow");',
      imports,
    );
    expect(out.map((f) => f.severity)).toEqual(['medium']);
    expect(out[0]!.message).toContain('bound');
    expect(out[0]!.message).toContain('non empty check');
  });

  it('assertEquals(1, n) becomes assertNotEquals(0, n), a count lower bound (flutter-intellij#5715)', async () => {
    const out = await a002('    assertEquals(1, callCount.get());', '    assertNotEquals(0, callCount.get());');
    expect(out.map((f) => f.severity)).toEqual(['medium']);
  });

  it('keeps other negative checks apart: assertEquals(5, n) to assertNotEquals(6, n) is not paired', async () => {
    expect(await a002('    assertEquals(5, total());', '    assertNotEquals(6, total());')).toEqual([]);
  });

  it('a Hamcrest matcher inside a project chain loosens from equalTo to greaterThan (druid#19155)', async () => {
    const out = await a002(
      '    emitter.waitForEvent(event -> event.hasMetricName(COUNT).hasValueMatching(Matchers.equalTo(4L)));',
      '    emitter.waitForEvent(event -> event.hasMetricName(COUNT).hasValueMatching(Matchers.greaterThan(1L)));',
      'import org.hamcrest.Matchers;',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: 'medium', label: 'nested' });
  });

  it('records nested matcher checks without counting them as assertions', async () => {
    const inv = await javaFrontEnd.inventory(PATH, file('    emitter.waitForEvent(event -> event.hasValueMatching(Matchers.equalTo(4L)));', 'import org.hamcrest.Matchers;'), profile);
    const t = inv.tests[0]!;
    expect(t.assertions).toEqual([]);
    expect(t.embedded?.map((a) => a.callee)).toEqual(['hasValueMatching.equalTo']);
  });

  it('records locals declared once', async () => {
    const inv = await javaFrontEnd.inventory(PATH, file('    String a = body.get().trim();\n    int n = 1;\n    n = 2;\n    assertEquals("x", a);'), profile);
    expect(inv.tests[0]!.locals).toEqual({ a: 'body.get().trim()' });
  });

  it('stays silent when the head is stronger or the same rank in another library', async () => {
    expect(await a002('    assertTrue(s.contains("x"));', '    assertEquals("x", s);')).toEqual([]);
    expect(await a002('    assertEquals(3, items.size());', '    assertThat(items).hasSize(3);', 'import static org.assertj.core.api.Assertions.assertThat;')).toEqual([]);
  });
});
