// Fuzz: the annotation writer and the Action's log lines (docs/threat-model.md, "Untrusted text in every output").
// The runner reads the step log for workflow commands, so text from a pull request must never start a line with `::`
// or bring a line break of its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { hasUnsafe, type Finding } from '@testwitness/core';
import { fuzz, hostileText, HOSTILE, TARGET_TIMEOUT_MS } from '../../../fuzz/kit.js';
import { annotationsFor, emitAnnotations, findOwnComment, info, logLine, MAX_ANNOTATIONS } from './annotations.js';

const text = hostileText();
const finding: fc.Arbitrary<Finding> = fc.record(
  {
    ruleId: fc.oneof(fc.constantFrom('R001', 'A002', 'W006'), text),
    severity: fc.constantFrom('high', 'medium', 'low'),
    message: text,
    location: fc.record({ path: text, line: fc.oneof(fc.integer({ min: -5, max: 99999 }), fc.constantFrom(Number.NaN, 1.5, Infinity)) }, { requiredKeys: ['path'] }),
    fingerprint: fc.constant('f'),
    label: text,
    acknowledged: fc.constant({ by: 'm', reason: 'r', at: '', via: 'comment' as const }),
  },
  { requiredKeys: ['ruleId', 'severity', 'message', 'location', 'fingerprint'] },
) as fc.Arbitrary<Finding>;

/** Everything written to stdout while `run` runs. */
function captured(run: () => void): string {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return out;
}

/** One workflow command line as the runner reads it: `::name key=value,key=value::message`. */
const COMMAND = /^::(error|warning|notice) ([^:\r\n]*)::([^\r\n]*)$/;

afterEach(() => vi.restoreAllMocks());

describe('fuzz: annotation writer', () => {
  it('writes exactly one well formed command line per open finding, and nothing else', async () => {
    await fuzz('annotation writer', fc.tuple(fc.array(finding, { maxLength: 6 }), fc.boolean()), ([findings, strict]) => {
      const expected = annotationsFor(findings, strict);
      expect(expected.length).toBe(findings.filter((f) => !f.acknowledged).length);
      const out = captured(() => emitAnnotations(findings, strict));
      expect(out === '' || out.endsWith('\n')).toBe(true);
      // The runner splits the log at LF and at CR; every piece must be one of our commands.
      const lines = out.split(/\r\n|\r|\n/).filter((l, i, all) => !(i === all.length - 1 && l === ''));
      expect(lines.length).toBe(expected.length);
      lines.forEach((line, i) => {
        const m = COMMAND.exec(line);
        expect(m, JSON.stringify(line)).not.toBeNull();
        expect(m![1]).toBe(expected[i]!.level);
        // Properties: comma separated key=value, with `:` and `,` of the values percent encoded by @actions/core.
        const props = Object.fromEntries(m![2]!.split(',').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
        // @actions/core leaves out a property whose value is empty (a finding without a path).
        expect(Object.keys(props).sort()).toEqual(expected[i]!.properties.file ? ['file', 'line', 'title'] : ['line', 'title']);
        expect(props['line']).toMatch(/^[1-9]\d*$/);
        expect(props['title']!.startsWith('testwitness ')).toBe(true);
        // No second command inside the message, in either spelling the runner knows.
        expect(m![3]).not.toContain('##[');
        expect(hasUnsafe(line)).toBe(false);
        expect(line.length).toBeLessThan(12_000);
      });
    });
  }, TARGET_TIMEOUT_MS);

  it('log lines from untrusted text are one safe line that cannot be read as a command', async () => {
    await fuzz('action log line', text, (s) => {
      const out = captured(() => info(s));
      expect(out.endsWith('\n')).toBe(true);
      const line = out.slice(0, -1);
      expect(line.startsWith('testwitness: ')).toBe(true);
      expect(hasUnsafe(line)).toBe(false);
      expect(line).not.toContain('##[');
      expect(logLine(logLine(s))).toBe(logLine(s));
    });
  }, TARGET_TIMEOUT_MS);
});

describe('regression: the step log', () => {
  it('a file name with a line break cannot inject a workflow command', () => {
    const f: Finding = { ruleId: 'R001', severity: 'high', message: 'Test gone\n::error file=x::forged\r::stop-commands::tok\u2028::add-mask::high %0A::notice::x', location: { path: 'a\n::error::forged.ts', line: 3 }, fingerprint: 'f', label: 'l\n::warning::w' };
    const out = captured(() => emitAnnotations([f], false));
    const lines = out.trimEnd().split(/\r\n|\r|\n|\u2028/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::warning title=testwitness R001,file=a %3A%3Aerror%3A%3Aforged.ts,line=3::Test gone ::error file=x::forged ::stop-commands::tok ::add-mask::high %250A::notice::x \(l ::warning::w\)$/);
  });

  it('a log line cannot start a command, in the :: form or in the ##[ form', () => {
    expect(captured(() => info('3 matched paths were skipped (junit\n::stop-commands::t\n.xml)'))).toBe('testwitness: 3 matched paths were skipped (junit ::stop-commands::t .xml)\n');
    expect(logLine('a ##[error]forged ##[add-mask]x')).toBe('a ## [error]forged ## [add-mask]x');
    for (const h of HOSTILE) {
      const line = `testwitness: ${logLine(h)}`;
      expect(line).not.toMatch(/^\s*::/);
      expect(line).not.toContain('##[');
      expect(hasUnsafe(line)).toBe(false);
    }
  });

  it('at most MAX_ANNOTATIONS are written, acknowledged findings are not, and a bad line number becomes 1', () => {
    const many = Array.from({ length: MAX_ANNOTATIONS + 50 }, (_, i): Finding => ({ ruleId: 'R001', severity: 'low', message: `m${i}`, location: { path: 'a.ts', line: i % 2 ? -1 : Number.NaN }, fingerprint: String(i) }));
    const list = annotationsFor(many, true);
    expect(list).toHaveLength(MAX_ANNOTATIONS);
    expect(list.every((a) => a.properties.startLine === 1 && a.level === 'notice')).toBe(true);
    expect(annotationsFor([{ ...many[0]!, acknowledged: { by: 'm', reason: 'r', at: '', via: 'comment' } }], true)).toEqual([]);
    expect(annotationsFor([{ ...many[0]!, severity: 'high' }], true)[0]!.level).toBe('error');
    expect(annotationsFor([{ ...many[0]!, severity: 'high' }], false)[0]!.level).toBe('warning');
  });
});

describe('regression: which comment the Action updates', () => {
  const MARK = '<!-- testwitness-report -->';
  it('does not adopt a comment a contributor wrote with the marker in it', () => {
    const planted = { id: 1, body: `${MARK}\n## testwitness: pass`, user: { login: 'mallory', type: 'User' }, author_association: 'CONTRIBUTOR' };
    const quoted = { id: 2, body: `I saw this:\n> ${MARK}`, user: { login: 'github-actions[bot]', type: 'Bot' }, author_association: 'NONE' };
    const own = { id: 3, body: `${MARK}\n## testwitness: review`, user: { login: 'github-actions[bot]', type: 'Bot' }, author_association: 'NONE' };
    expect(findOwnComment([planted, quoted], MARK)).toBeUndefined();
    expect(findOwnComment([planted, quoted, own], MARK)?.id).toBe(3);
    for (const association of ['NONE', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'CONTRIBUTOR', 'MANNEQUIN']) expect(findOwnComment([{ ...planted, author_association: association }], MARK)).toBeUndefined();
  });

  it('still finds its own comment when the token belongs to a machine user with write access', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) expect(findOwnComment([{ id: 7, body: MARK, user: { login: 'ci-user', type: 'User' }, author_association: association }], MARK)?.id).toBe(7);
  });
});
