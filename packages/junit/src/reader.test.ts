import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { emptyIndex, readJunitFiles, readJunitStream, readJunitString, toEvidence } from './reader.js';

const SUREFIRE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.acme.FooTest" time="0.1" tests="4" errors="1" skipped="1" failures="1">
  <properties><property name="java.version" value="21"/></properties>
  <testcase name="adds" classname="com.acme.FooTest" time="0.01"/>
  <testcase name="skips" classname="com.acme.FooTest" time="0"><skipped message="nope"/></testcase>
  <testcase name="fails" classname="com.acme.FooTest" time="0.02"><failure message="x" type="AssertionError">trace</failure></testcase>
  <testcase name="errs" classname="com.acme.FooTest" time="0.02"><error message="boom" type="RuntimeException">trace</error></testcase>
  <testcase name="flaky" classname="com.acme.FooTest" time="0.02"><flakyFailure message="first try">trace</flakyFailure></testcase>
  <testcase name="param(int)[1]" classname="com.acme.FooTest$Inner" time="0.02"/>
  <testcase name="param(int)[2]" classname="com.acme.FooTest$Inner" time="0.02"><failure/></testcase>
</testsuite>`;

describe('readJunitString', () => {
  it('indexes statuses and totals', async () => {
    const d = await readJunitString(SUREFIRE);
    expect(d.totals).toEqual({ total: 6, passed: 2, failed: 2, errored: 1, skipped: 1, flaky: 1 });
    expect(d.records.get('footest::adds')?.status).toBe('passed');
    expect(d.records.get('footest::skips')?.status).toBe('skipped');
    expect(d.records.get('footest::fails')?.status).toBe('failed');
    expect(d.records.get('footest::errs')?.status).toBe('error');
    expect(d.records.get('footest::flaky')?.status).toBe('flaky');
    expect(d.records.get('footest::flaky')?.reruns).toBe(1);
  });

  it('merges parametrised cases under one key keeping the worst status', async () => {
    const d = await readJunitString(SUREFIRE);
    const r = d.records.get('footest$inner::param');
    expect(r?.status).toBe('failed');
    expect(d.byClass.get('footest$inner')).toEqual(['footest$inner::param']);
  });

  it('handles nested testsuites and missing classname', async () => {
    const d = await readJunitString(`<testsuites><testsuite name="outer"><testsuite name="inner suite"><testcase name="a"/></testsuite></testsuite></testsuites>`);
    expect([...d.records.keys()]).toEqual(['inner suite::a']);
  });

  it('warns on files with no testcases and on malformed xml without throwing', async () => {
    const d = await readJunitString('<testsuite name="x"></testsuite>');
    expect(d.warnings[0]).toMatch(/no testcase/);
    const bad = await readJunitString('<testsuite><testcase name="a"></testsuite');
    expect(bad.warnings.length).toBeGreaterThan(0);
  });

  it('exposes an Evidence view', async () => {
    const e = toEvidence(await readJunitString(SUREFIRE));
    expect(e.has('footest::adds')).toBe(true);
    expect(e.statusOf('footest::nope')).toBeUndefined();
    expect(e.keysForClass('footest').length).toBe(5);
  });

  it('keeps multibyte characters whole across read chunk boundaries', async () => {
    // Enough 3 byte characters at shifting offsets that every chunk boundary of a file read lands inside one somewhere.
    let xml = '<testsuites><testsuite name="s">';
    for (let i = 0; i < 6000; i++) xml += `<testcase classname="Billing › charge ${i}" name="${'›'.repeat(1 + (i % 7))} ${i}"/>`;
    xml += '</testsuite></testsuites>';
    const dir = mkdtempSync(join(tmpdir(), 'tw-junit-'));
    try {
      const file = join(dir, 'junit.xml');
      writeFileSync(file, xml);
      const d = await readJunitFiles([file]);
      expect(d.records.size).toBe(6000);
      const names = [...d.records.values()].map((r) => r.classname + ' ' + r.name);
      expect(names.filter((n) => n.includes('\uFFFD'))).toEqual([]);
      expect(names).toContain('Billing › charge 2 ››› 2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('decodes a buffer stream whose chunks split a character', async () => {
    const bytes = Buffer.from('<testsuite name="s"><testcase classname="c" name="a › b"/></testsuite>', 'utf8');
    const cut = bytes.indexOf(Buffer.from('›', 'utf8')) + 1; // one byte into the 3 byte sequence
    const data = emptyIndex();
    await readJunitStream(Readable.from([bytes.subarray(0, cut), bytes.subarray(cut)]), 'split.xml', data);
    expect([...data.records.values()].map((r) => r.name)).toEqual(['a › b']);
  });
});

describe('duplicate keys across files', () => {
  const MAVEN = join(import.meta.dirname, '../../../fixtures/java-junit5-maven/junit');

  it('treats the same raw test failed in one file and passed in another as flaky (Surefire rerun split across TEST-*.xml)', async () => {
    const d = await readJunitFiles([join(MAVEN, 'TEST-demo.CalculatorTest$Division.xml'), join(MAVEN, 'TEST-demo.CalculatorTest.xml')]);
    const flaky = d.records.get('calculatortest::flakypassesonsecondattempt');
    expect(flaky?.status).toBe('flaky');
    expect(flaky?.reruns).toBe(1);
    // failed in both files stays failed and keeps the rerunFailure count
    const failed = d.records.get('calculatortest::failsonpurpose');
    expect(failed?.status).toBe('failed');
    expect(failed?.reruns).toBe(1);
    // nested class tests keep their own class key
    expect(d.records.get('calculatortest$division::dividesevenly')?.status).toBe('passed');
    expect(d.totals).toEqual({ total: 8, passed: 6, failed: 1, errored: 0, skipped: 1, flaky: 1 });
  });

  it('keeps the worst status when different parametrised rows normalise to one key', async () => {
    const d = await readJunitString(
      '<testsuite name="s"><testcase classname="demo.T" name="rows(int)[1]"/><testcase classname="demo.T" name="rows(int)[2]"><failure/></testcase></testsuite>',
    );
    expect(d.records.get('t::rows')?.status).toBe('failed');
  });

  it('keeps the worst status when the same raw name repeats inside one file', async () => {
    const d = await readJunitString(
      '<testsuite name="s"><testcase classname="demo.T" name="a"><failure/></testcase><testcase classname="demo.T" name="a"/></testsuite>',
    );
    expect(d.records.get('t::a')?.status).toBe('failed');
  });
});
