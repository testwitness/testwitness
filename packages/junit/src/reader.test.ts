import { describe, expect, it } from 'vitest';
import { readJunitString, toEvidence } from './reader.js';

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
});
