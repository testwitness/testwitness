import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normaliseCoveragePath, readCoverageFiles, readCoverageString, sniffCoverageFormat, toCoverageEvidence } from './reader.js';

const LCOV = ['TN:', 'SF:/home/runner/work/app/app/src/cart.ts', 'FN:1,add', 'DA:1,4', 'DA:2,0', 'DA:5,1', 'LF:3', 'LH:2', 'end_of_record', 'SF:src/util.ts', 'DA:3,0', 'end_of_record', ''].join('\n');

const COBERTURA = `<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage version="7.6.1" timestamp="1730700000000" lines-valid="4" lines-covered="2" line-rate="0.5" branches-covered="0" branches-valid="0" branch-rate="0" complexity="0">
	<sources>
		<source>/home/runner/work/app/app/src</source>
	</sources>
	<packages>
		<package name="billing" line-rate="0.5" branch-rate="0" complexity="0">
			<classes>
				<class name="refund.py" filename="billing/refund.py" complexity="0" line-rate="0.5" branch-rate="0">
					<methods>
						<method name="refund" signature="" line-rate="1"><lines><line number="99" hits="1"/></lines></method>
					</methods>
					<lines>
						<line number="1" hits="1"/>
						<line number="2" hits="1"/>
						<line number="4" hits="0"/>
						<line number="5" hits="0" branch="true" condition-coverage="0% (0/2)"/>
					</lines>
				</class>
			</classes>
		</package>
	</packages>
</coverage>
`;

const JACOCO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="demo"><sessioninfo id="x" start="1" dump="2"/><package name="com/acme"><class name="com/acme/Refund" sourcefilename="Refund.java"><method name="refund" desc="()V" line="10"><counter type="LINE" missed="1" covered="1"/></method></class><sourcefile name="Refund.java"><line nr="10" mi="0" ci="3" mb="0" cb="0"/><line nr="11" mi="2" ci="0" mb="0" cb="0"/><line nr="14" mi="0" ci="1" mb="1" cb="1"/><counter type="LINE" missed="1" covered="2"/></sourcefile></package></report>`;

describe('coverage readers', () => {
  it('sniffs the format from the first bytes', () => {
    expect(sniffCoverageFormat(LCOV)).toBe('lcov');
    expect(sniffCoverageFormat(COBERTURA)).toBe('cobertura');
    expect(sniffCoverageFormat(JACOCO)).toBe('jacoco');
    expect(sniffCoverageFormat('<testsuites></testsuites>')).toBeUndefined();
    expect(sniffCoverageFormat('hello')).toBeUndefined();
  });

  it('normalises paths against the repository root and Cobertura sources', () => {
    expect(normaliseCoveragePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(normaliseCoveragePath('C:\\repo\\src\\a.ts', 'C:/repo')).toBe('src/a.ts');
    expect(normaliseCoveragePath('./src/a.ts', '/repo')).toBe('src/a.ts');
    expect(normaliseCoveragePath('billing/refund.py', '/repo', ['/repo/src'])).toBe('src/billing/refund.py');
    expect(normaliseCoveragePath('billing/refund.py', '/repo', ['src'])).toBe('src/billing/refund.py');
    expect(normaliseCoveragePath('billing/refund.py', '/repo', ['/ci/other/src'])).toBe('billing/refund.py');
  });

  it('reads lcov line hits', async () => {
    const ev = toCoverageEvidence(await readCoverageString(LCOV, 'lcov.info', '/home/runner/work/app/app'));
    expect(ev.files).toBe(2);
    expect(ev.linesInstrumented).toBe(4);
    expect(ev.linesExecuted).toBe(2);
    const cart = ev.lookup('src/cart.ts')!;
    expect([...cart.instrumented]).toEqual([1, 2, 5]);
    expect([...cart.executed]).toEqual([1, 5]);
  });

  it('reads Cobertura class lines, not method lines, and resolves the source root', async () => {
    const ev = toCoverageEvidence(await readCoverageString(COBERTURA, 'coverage.xml', '/home/runner/work/app/app'));
    const f = ev.lookup('src/billing/refund.py')!;
    expect([...f.instrumented]).toEqual([1, 2, 4, 5]);
    expect([...f.executed]).toEqual([1, 2]);
  });

  it('reads JaCoCo sourcefile lines and finds them by package path suffix', async () => {
    const ev = toCoverageEvidence(await readCoverageString(JACOCO, 'jacoco.xml'));
    const f = ev.lookup('service/src/main/java/com/acme/Refund.java')!;
    expect([...f.instrumented]).toEqual([10, 11, 14]);
    expect([...f.executed]).toEqual([10, 14]);
    expect(ev.lookup('src/main/java/com/other/Refund.java')).toBeUndefined();
  });

  it('matches absolute report paths from another checkout by suffix, preferring the longest', async () => {
    const lcov = ['SF:/ci/x/a/src/util.ts', 'DA:1,1', 'end_of_record', 'SF:/ci/x/b/src/util.ts', 'DA:1,0', 'end_of_record'].join('\n');
    const ev = toCoverageEvidence(await readCoverageString(lcov, 'lcov.info', '/local/repo'));
    expect([...ev.lookup('b/src/util.ts')!.executed]).toEqual([]);
    expect([...ev.lookup('a/src/util.ts')!.executed]).toEqual([1]);
  });

  it('merges several reports and keeps warnings for unreadable ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-cov-'));
    try {
      writeFileSync(join(dir, 'a.info'), 'SF:src/x.ts\nDA:1,0\nDA:2,1\nend_of_record\n');
      writeFileSync(join(dir, 'b.info'), 'SF:src/x.ts\nDA:1,3\nend_of_record\n');
      writeFileSync(join(dir, 'junk.xml'), '<testsuites/>');
      const data = await readCoverageFiles([join(dir, 'a.info'), join(dir, 'b.info'), join(dir, 'junk.xml')], dir);
      const ev = toCoverageEvidence(data);
      expect([...ev.lookup('src/x.ts')!.executed].sort()).toEqual([1, 2]);
      expect(ev.sources).toHaveLength(2);
      expect(data.warnings.join('\n')).toContain('junk.xml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops at the file and byte caps with a warning', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-cov-'));
    try {
      const files = [0, 1, 2].map((i) => {
        const p = join(dir, `${i}.info`);
        writeFileSync(p, `SF:src/f${i}.ts\nDA:1,1\nend_of_record\n`);
        return p;
      });
      const byCount = await readCoverageFiles(files, dir, { maxFiles: 2 });
      expect(byCount.sources).toHaveLength(2);
      expect(byCount.capped).toBe(true);
      const byBytes = await readCoverageFiles(files, dir, { maxBytes: 60 });
      expect(byBytes.sources).toHaveLength(1);
      expect(byBytes.warnings.join('\n')).toContain('MB cap');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives malformed XML without throwing', async () => {
    const data = await readCoverageString('<coverage><packages><class filename="a.py"><lines><line number="1" hits="1"/>', 'bad.xml');
    expect(data.warnings.length).toBeGreaterThan(0);
  });
});
