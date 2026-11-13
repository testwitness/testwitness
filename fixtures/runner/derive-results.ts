/**
 * Derive the results file of a V003 positive case from a real one by removing one named test record, and nothing
 * else. The JUnit XML positives were made the same way (one testcase element removed); this script covers the other
 * formats the reader understands.
 *
 *   pnpm exec tsx fixtures/runner/derive-results.ts <real file> <derived file> <test name>
 *
 * The test name is matched as the format writes it:
 *   TAP                  the point description (`lowercases and joins with dashes`); the point line, its
 *                        `# Subtest:` heading, its YAML block and any subtest block before it are removed
 *   Jest, Vitest JSON    assertionResults[].fullName
 *   pytest-json-report   tests[].nodeid
 *   Playwright JSON      specs[].title; the whole spec (every project's test) is removed
 * Exactly one record must match, or the script fails. JSON is written back with the reporter's own whitespace when
 * the untouched document round trips through JSON.stringify unchanged (Jest, Vitest, Playwright); otherwise it is
 * written with JSON.stringify(doc) and the script says so (pytest-json-report mixes its own line breaks in).
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Json = Record<string, unknown>;

function fail(msg: string): never {
  process.stderr.write(`derive-results: ${msg}\n`);
  process.exit(1);
}

function deriveTap(text: string, name: string): { text: string; removed: number } {
  const lines = text.split('\n');
  const point = (l: string) => /^(\s*)(not ok|ok)\b\s*\d*\s*(?:-\s*)?(.*)$/i.exec(l);
  const desc = (rest: string) => rest.replace(/\s+#.*$/, '').trim();
  const hits: number[] = [];
  lines.forEach((l, i) => {
    const m = point(l);
    if (m && desc(m[3]!) === name) hits.push(i);
  });
  if (hits.length !== 1) fail(`expected one TAP point named ${JSON.stringify(name)}, found ${hits.length}`);
  const at = hits[0]!;
  const indent = point(lines[at]!)![1]!.length;
  // Forward: the YAML block, indented deeper than the point, up to its closing `...`.
  let end = at + 1;
  if (lines[end]?.trim() === '---' && lines[end]!.search(/\S/) > indent) {
    while (end < lines.length && lines[end]!.trim() !== '...') end++;
    end++;
  }
  // Backward: a subtest block (lines indented deeper) and the `# Subtest:` heading at the point's indentation.
  // A YAML block just above belongs to the previous sibling, not to a subtest block of this point.
  let start = at;
  if (lines[at - 1]?.trim() !== '...') while (start > 0 && (lines[start - 1]!.trim() === '' || lines[start - 1]!.search(/\S/) > indent)) start--;
  if (start > 0 && new RegExp(`^\\s{${indent}}#\\s*Subtest:\\s*`).test(lines[start - 1]!) && lines[start - 1]!.replace(/^\s*#\s*Subtest:\s*/, '').trim() === name) start--;
  const removed = end - start;
  lines.splice(start, removed);
  return { text: lines.join('\n'), removed };
}

function deriveJson(doc: Json, name: string): number {
  let removed = 0;
  if (Array.isArray(doc['testResults'])) {
    for (const f of doc['testResults'] as Json[]) {
      const before = (f['assertionResults'] as Json[]).length;
      f['assertionResults'] = (f['assertionResults'] as Json[]).filter((a) => a['fullName'] !== name);
      removed += before - (f['assertionResults'] as Json[]).length;
    }
  } else if (Array.isArray(doc['tests'])) {
    const before = (doc['tests'] as Json[]).length;
    doc['tests'] = (doc['tests'] as Json[]).filter((t) => t['nodeid'] !== name);
    removed = before - (doc['tests'] as Json[]).length;
  } else if (Array.isArray(doc['suites'])) {
    const walk = (s: Json) => {
      if (Array.isArray(s['specs'])) {
        const before = (s['specs'] as Json[]).length;
        s['specs'] = (s['specs'] as Json[]).filter((sp) => sp['title'] !== name);
        removed += before - (s['specs'] as Json[]).length;
      }
      for (const c of (s['suites'] as Json[] | undefined) ?? []) walk(c);
    };
    for (const s of doc['suites'] as Json[]) walk(s);
  } else fail('not a Jest, Vitest, pytest-json-report or Playwright JSON report');
  return removed;
}

const [input, output, name] = process.argv.slice(2);
if (!input || !output || !name) fail('usage: derive-results.ts <real file> <derived file> <test name>');
const text = readFileSync(input, 'utf8');
if (text.trimStart().startsWith('{')) {
  const doc = JSON.parse(text) as Json;
  const style = [undefined, 2].find((indent) => JSON.stringify(doc, null, indent) === text || JSON.stringify(doc, null, indent) + '\n' === text);
  const removed = deriveJson(doc, name);
  if (removed !== 1) fail(`expected one record named ${JSON.stringify(name)}, removed ${removed}`);
  const trailing = text.endsWith('\n') ? '\n' : '';
  writeFileSync(output, JSON.stringify(doc, null, style) + trailing);
  const kept = [undefined, 2].some((indent) => JSON.stringify(JSON.parse(text), null, indent) + trailing === text);
  process.stdout.write(`removed 1 record named ${JSON.stringify(name)}; ${kept ? "the reporter's whitespace is kept" : 'written with JSON.stringify, the reporter whitespace is not kept'}\n`);
} else {
  const { text: out, removed } = deriveTap(text, name);
  writeFileSync(output, out);
  process.stdout.write(`removed ${removed} lines of the TAP point named ${JSON.stringify(name)}\n`);
}
