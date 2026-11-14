// Fuzz: untrusted text in the Markdown, text and JSON renderers (docs/threat-model.md, "Untrusted text in every output").
// The properties are about structure, not wording: whatever a test name, a path, PR text or a results file holds, the
// rendered report has the same shape as the same report with harmless text, and no character or construct arrives that
// could steer GitHub (mentions, links, HTML, issue references) or a terminal (control and bidirectional characters).
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createMarkdownRenderer } from 'vitepress';
import { fuzz, hostileText, HOSTILE, TARGET_TIMEOUT_MS } from '../../../../fuzz/kit.js';
import type { Finding, Report } from '../types.js';
import { codeCell, esc, escBlock, renderMarkdown } from './markdown.js';
import { renderText } from './text.js';
import { jsonText, renderJson } from './json.js';
import { hasUnsafe, multiLine, oneLine } from './sanitize.js';

const raw = hostileText();
// In a report, text that is only whitespace renders as nothing; the esc target covers it. Here it would only make the
// harmless twin differ by an empty paragraph.
const text = raw.filter((s) => s === '' || oneLine(s).trim() !== '');
const count = fc.nat({ max: 99 });

const finding: fc.Arbitrary<Finding> = fc.record(
  {
    ruleId: fc.constantFrom('R001', 'A002', 'W006', 'V005'),
    severity: fc.constantFrom('high', 'medium', 'low'),
    message: text,
    location: fc.record({ path: text, line: fc.integer({ min: 1, max: 99999 }) }, { requiredKeys: ['path'] }),
    fingerprint: fc.constant('f'.repeat(16)),
    subject: text,
    before: text,
    after: text,
    label: text,
    acknowledged: fc.record({ by: text, reason: text, at: fc.constant('2026-11-13'), via: fc.constantFrom('config', 'comment', 'label') }),
  },
  { requiredKeys: ['ruleId', 'severity', 'message', 'location', 'fingerprint'] },
) as fc.Arbitrary<Finding>;

const report: fc.Arbitrary<Report> = fc.record(
  {
    $schema: fc.constant('s'),
    schemaVersion: fc.constant('1'),
    tool: fc.constant({ name: 'testwitness', version: '0.1.0' }),
    generatedAt: fc.constant('2026-11-13T00:00:00.000Z'),
    state: fc.constantFrom('pass', 'review', 'unreadable'),
    mode: fc.constantFrom('report', 'require-ack', 'strict'),
    summary: fc.record({ testsDeleted: count, testsSkipped: count, assertionsWeakened: count, changedTestsNotRun: count, findings: fc.record({ high: count, medium: count, low: count }) }),
    findings: fc.array(finding, { maxLength: 4 }),
    evidence: fc.record({ state: fc.constantFrom('read', 'unreadable', 'partial'), sources: fc.array(text, { maxLength: 2 }), formats: fc.array(fc.constantFrom('junit-xml', 'tap', 'jest-json'), { maxLength: 2 }), total: count, passed: count, failed: count, errored: count, skipped: count, flaky: count, notes: fc.array(text, { maxLength: 2 }) }),
    provenance: fc.record({ agents: fc.array(fc.record({ name: text, signals: fc.array(text, { minLength: 1, maxLength: 2 }) }), { maxLength: 2 }), botAuthor: text }, { requiredKeys: ['agents'] }),
    notes: fc.array(text, { maxLength: 2 }),
    files: fc.constant({ changed: 3, tests: 1, production: 2, config: 0, workflows: 0, snapshots: 0 }),
    timing: fc.constant({ totalMs: 12, parseMs: 1, rulesMs: 1, evidenceMs: 1 }),
    helperIndex: fc.record({ files: count, parsed: count, cached: count, helpers: count, capped: fc.boolean(), warnings: fc.array(text, { maxLength: 2 }), resolved: fc.array(fc.record({ path: text, test: text, line: count, helper: text, definedIn: text, definedLine: count }), { maxLength: 2 }) }),
    base: fc.constant('b'.repeat(40)),
    head: fc.constant('h'.repeat(40)),
  },
  { requiredKeys: ['$schema', 'schemaVersion', 'tool', 'generatedAt', 'state', 'mode', 'summary', 'findings', 'evidence', 'provenance', 'files', 'timing', 'base', 'head'] },
) as unknown as fc.Arbitrary<Report>;

/** The same report with every string that could come from a pull request replaced by harmless text of the same emptiness. */
function harmless<T>(value: T, key = ''): T {
  const KEEP = new Set(['ruleId', 'severity', 'state', 'mode', 'schemaVersion', '$schema', 'generatedAt', 'fingerprint', 'via', 'at', 'base', 'head', 'name', 'version', 'formats']);
  if (typeof value === 'string') return (KEEP.has(key) || value === '' ? value : 'x') as T;
  if (Array.isArray(value)) return value.map((v) => harmless(v, key)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, key === 'tool' || k === 'formats' ? v : harmless(v, k)])) as T;
  return value;
}

/** Tag names of rendered HTML in order, the shape of the document without its text. */
function skeleton(html: string): string[] {
  return [...html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => `${m[1]}${m[2]!.toLowerCase()}`);
}

/** Character references the renderer itself writes; any other `&` would be one the text brought along. */
const OWN_REFERENCES = /&(?:amp;|#64;&#8203;|#8203;)/g;
const decode = (s: string): string => s.replace(/&#8203;/g, '\u200b').replace(/&#64;/g, '@').replace(/&amp;/g, '&');

/** Pipes that end a table cell, read the cmark-gfm way (backslashes pair up) and the markdown-it way (any backslash before a pipe escapes it). */
function cellBoundaries(row: string): { paired: number; anyBackslash: number } {
  let paired = 0;
  let anyBackslash = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '|' && row[i - 1] !== '\\') anyBackslash++;
  }
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\') i++;
    else if (row[i] === '|') paired++;
  }
  return { paired, anyBackslash };
}

function checkSafeMarkdownText(out: string): void {
  // One line, no control, bidirectional or invisible character.
  expect(hasUnsafe(out)).toBe(false);
  // No mention: no @ at all, and no character reference but the renderer's own.
  expect(out).not.toContain('@');
  expect(out.replace(OWN_REFERENCES, '')).not.toContain('&');
  // Every Markdown special character is escaped by a backslash of its own (the renderer's own references aside).
  const body = out.replace(OWN_REFERENCES, ' ');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      expect('\\`*_{}[]()#+!|<>~-.=', `escape of ${JSON.stringify(body[i + 1])}`).toContain(body[i + 1] ?? 'end of text');
      i++;
    } else expect('`*_{}[]()#+!|<>', `unescaped ${body[i]} at ${i} in ${JSON.stringify(out)}`).not.toContain(body[i]!);
  }
  // What GitHub sees after it decodes the references: no mention, no link, no issue reference.
  const seen = decode(out);
  expect(seen).not.toMatch(/@[A-Za-z0-9_-]/);
  expect(seen).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
  expect(seen).not.toMatch(/(?:^|[^a-z0-9])www\.[^\s]/i);
  expect(seen).not.toMatch(/#\d/);
  expect(seen).not.toMatch(/\bGH-\d/i);
}

describe('fuzz: Markdown renderer', () => {
  let md: Awaited<ReturnType<typeof createMarkdownRenderer>>;
  beforeAll(async () => {
    md = await createMarkdownRenderer(process.cwd(), { linkify: true, html: true });
    // As GitHub: a link needs a scheme (or www., which the text checks below cover); `//host` and bare domains are not links.
    md.linkify.set({ fuzzyLink: false }).add('//', null);
  });

  it('esc: one safe line, every special character escaped, no mention, link or issue reference survives', async () => {
    await fuzz('markdown esc', raw, (s) => {
      for (const out of [esc(s), escBlock(s)]) {
        checkSafeMarkdownText(out);
        expect(out.length).toBeLessThanOrEqual(600 * 14);
      }
      expect(escBlock(s)).not.toMatch(/^(?:\s|[-+=]|\d+\.)/);
    });
  }, TARGET_TIMEOUT_MS);

  it('codeCell: stays inside its code span and its table cell', async () => {
    await fuzz('markdown codeCell', raw, (s) => {
      const out = codeCell(s);
      expect(hasUnsafe(out)).toBe(false);
      expect(out).not.toContain('`');
      expect(cellBoundaries(out)).toEqual({ paired: 0, anyBackslash: 0 });
      const html = md.render(`| a | b |\n|---|---|\n| \`${out}\` | end |\n`);
      expect(skeleton(html)).toEqual(skeleton(md.render('| a | b |\n|---|---|\n| `x` | end |\n')));
    });
  }, TARGET_TIMEOUT_MS);

  it('renderMarkdown: the document has the shape of the same report with harmless text', async () => {
    await fuzz('markdown report', fc.tuple(report, fc.boolean()), ([r, collapseLow]) => {
      const out = renderMarkdown(r, { collapseLow });
      const plainOut = renderMarkdown(harmless(r), { collapseLow });
      const lines = out.split('\n');
      expect(lines.length).toBe(plainOut.split('\n').length);
      for (const whole of lines) {
        expect(hasUnsafe(whole)).toBe(false);
        if (whole.startsWith('| ')) expect(cellBoundaries(whole)).toEqual({ paired: 5, anyBackslash: 5 });
        // Inside the code span of the Where column nothing is decoded or linked, so the checks below skip it.
        const line = whole.startsWith('| ') ? whole.replace(/`[^`]*`/, '') : whole;
        expect(line).not.toContain('@');
        expect(line.replace(OWN_REFERENCES, '')).not.toContain('&');
        const seen = decode(line);
        expect(seen).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
        expect(seen).not.toMatch(/(?:^|[^a-z0-9])www\.[^\s]/i);
      }
      // An independent CommonMark parser (markdown-it, as VitePress configures it) agrees on the shape, and finds no link.
      const html = md.render(out);
      expect(skeleton(html)).toEqual(skeleton(md.render(plainOut)));
      for (const a of html.matchAll(/<a\b[^>]*>/g)) expect(a[0]).toMatch(/class="header-anchor"/);
      expect(html).not.toMatch(/<(script|img|iframe|style|form|input|object|embed|link|meta)\b/i);
    });
  }, TARGET_TIMEOUT_MS);
});

describe('fuzz: text renderer', () => {
  it('renderText: no control character but its own colour codes, and the lines of the same report with harmless text', async () => {
    await fuzz('text report', fc.tuple(report, fc.boolean(), fc.boolean()), ([r, color, collapseLow]) => {
      const out = renderText(r, { color, collapseLow });
      const lines = out.split('\n');
      expect(lines.length).toBe(renderText(harmless(r), { color, collapseLow }).split('\n').length);
      for (const line of lines) {
        // eslint-disable-next-line no-control-regex -- the renderer's own SGR sequences are the only escapes allowed
        const withoutColour = color ? line.replace(/\u001b\[[0-9;]{1,6}m/g, '') : line;
        expect(hasUnsafe(withoutColour), JSON.stringify(line)).toBe(false);
        expect(withoutColour.length).toBeLessThanOrEqual(1400);
      }
    });
  }, TARGET_TIMEOUT_MS);
});

describe('fuzz: JSON output and the sanitiser', () => {
  it('renderJson: parses back to the same report and holds no raw control or bidirectional character', async () => {
    await fuzz('json report', report, (r) => {
      const out = renderJson(r);
      expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(r)));
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    });
  }, TARGET_TIMEOUT_MS);

  it('oneLine and multiLine: idempotent, never longer, nothing unsafe left', async () => {
    await fuzz('sanitiser', raw, (s) => {
      const one = oneLine(s);
      expect(hasUnsafe(one)).toBe(false);
      expect(oneLine(one)).toBe(one);
      expect(one.length).toBeLessThanOrEqual(s.length);
      const many = multiLine(s);
      expect(hasUnsafe(many.replace(/[\n\t]/g, ''))).toBe(false);
      expect(multiLine(many)).toBe(many);
      expect(jsonText(s)).toBe(jsonText(JSON.parse(jsonText(s))));
    });
  }, TARGET_TIMEOUT_MS);
});

describe('regression: found by review and by the fuzzers', () => {
  it('a character reference in the text cannot become a mention or a link', () => {
    // GitHub decodes &#64; to @ before it looks for mentions; esc used to pass `&` through.
    expect(esc('ping &#64;octocat and &#x40;octocat')).toBe('ping &amp;\\#&#8203;64;octocat and &amp;\\#x40;octocat');
    expect(esc('see https&colon;//evil.test')).toBe('see https&amp;colon;//evil.test');
  });

  it('a lone carriage return, a line separator or a vertical tab cannot end a table row', () => {
    expect(esc('a\rb\u2028c\u2029d\u000be\u000cf\u0085g')).toBe('a b c d e f g');
    expect(codeCell('a\rb\u2028c')).toBe('a b c');
    const f: Finding = { ruleId: 'R001', severity: 'high', message: 'gone\r| R999 | high | `x` | forged row |', location: { path: 'a\r| forged |.ts' }, fingerprint: 'f' };
    const rows = renderMarkdown({ ...BASE, findings: [f] }).split(/\r\n|\r|\n/).filter((l) => l.startsWith('| '));
    expect(rows).toHaveLength(2);
  });

  it('control, bidirectional and invisible characters are replaced in Markdown and in text', () => {
    const hostile = 'ok\u001b[2J\u202egnp.exe\u2066\u200b\u{e0049}';
    expect(esc(hostile)).toBe('ok\ufffd\\[2J\ufffdgnp.exe\ufffd\ufffd\ufffd');
    expect(codeCell(hostile)).toBe('ok\ufffd[2J\ufffdgnp.exe\ufffd\ufffd\ufffd');
    const f: Finding = { ruleId: 'R001', severity: 'high', message: hostile, location: { path: hostile }, fingerprint: 'f' };
    expect(hasUnsafe(renderText({ ...BASE, findings: [f] }).replace(/\n/g, ''))).toBe(false);
  });

  it('a link without a word boundary in front of its scheme is broken up too', () => {
    // Found by the fuzzer: the scheme pattern asked for a word boundary, and `%25http://` has none before `http`.
    expect(esc('%25http://evil.test')).toBe('%25http:&#8203;//evil.test');
    expect(esc('xwww.evil.test')).toBe('xwww&#8203;.evil.test');
  });

  it('issue references and cross repository references are broken up', () => {
    expect(decode(esc('fixes #12, GH-7 and octo/repo#3'))).not.toMatch(/#\d|GH-\d/);
  });

  it('a backslash in front of a pipe in a path cannot open a new cell under either table grammar', () => {
    expect(codeCell('a\\|b')).toBe('a/\\|b');
    expect(cellBoundaries(codeCell('a\\\\|b\\'))).toEqual({ paired: 0, anyBackslash: 0 });
  });

  it('a note cannot start a list, a rule or a code block, and long text is cut', () => {
    expect(escBlock('- item')).toBe('\\- item');
    expect(escBlock('---')).toBe('\\---');
    expect(escBlock('===')).toBe('\\===');
    expect(escBlock('1. item')).toBe('1\\. item');
    expect(escBlock('    indented')).toBe('indented');
    expect(escBlock('+ item')).toBe('\\+ item');
    expect(esc('~~~')).toBe('\\~\\~~');
    expect(esc('x'.repeat(5000)).length).toBe(600);
    expect(codeCell('p'.repeat(5000)).length).toBe(300);
  });

  it('every hostile fragment alone leaves esc safe', () => {
    for (const h of HOSTILE) checkSafeMarkdownText(esc(h));
  });

  it('a report read from a JSON file cannot inject through fields that are not text', () => {
    const forged = { ...BASE, state: 'pass\n# forged', mode: '<b>x</b>', tool: { name: 'testwitness', version: '1 @octocat' }, summary: { ...BASE.summary, testsDeleted: '0 [x](https://evil.test)' } } as unknown as Report;
    const out = renderMarkdown(forged);
    expect(out).not.toContain('@');
    expect(out).not.toContain('https://');
    expect(out).not.toContain('\n# forged');
    expect(out).toContain('- Tests deleted: ?');
  });

  it('JSON output escapes what JSON.stringify leaves raw', () => {
    const out = jsonText({ name: 'a\u009b31m\u202eb\u2028c\u007f' });
    expect(out).toBe('{"name":"a\\u009b31m\\u202eb\\u2028c\\u007f"}');
    expect(JSON.parse(out)).toEqual({ name: 'a\u009b31m\u202eb\u2028c\u007f' });
  });
});

const BASE: Report = {
  $schema: 's',
  schemaVersion: '1',
  tool: { name: 'testwitness', version: '0.1.0' },
  generatedAt: '2026-11-13T00:00:00.000Z',
  state: 'review',
  mode: 'report',
  summary: { testsDeleted: 0, testsSkipped: 0, assertionsWeakened: 0, changedTestsNotRun: 0, findings: { high: 1, medium: 0, low: 0 } },
  findings: [],
  evidence: { state: 'unreadable', sources: [], total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, flaky: 0, notes: [] },
  provenance: { agents: [] },
  files: { changed: 1, tests: 1, production: 0, config: 0, workflows: 0, snapshots: 0 },
  timing: { totalMs: 1, parseMs: 0, rulesMs: 0, evidenceMs: 0 },
  base: 'b'.repeat(40),
  head: 'h'.repeat(40),
};
