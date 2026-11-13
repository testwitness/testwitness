/**
 * TAP reader: version 13 and 14 as written by Node's built in test runner (`node --test --test-reporter=tap`),
 * node-tap (`tap --reporter=tap`) and Perl's Test::More, read one line at a time.
 *
 * What is read: test points (`ok`, `not ok`, an optional number, the description up to the first unescaped `#`),
 * the SKIP and TODO directives, plans (`1..N`), `# Subtest: name` headings, indented subtests (4 spaces a level),
 * `Bail out!`, and in YAML diagnostic blocks only the top level `type:` key that Node writes (`'test'` or `'suite'`).
 * Everything else, including the rest of the YAML, is skipped without being parsed.
 *
 * Which test points are tests. TAP calls every `ok` line a test, but producers disagree on what an `ok` line means:
 *   Node     every test and every describe block is a point, and its YAML says `type: 'test'` or `type: 'suite'`;
 *            the type decides.
 *   node-tap a test is a subtest whose own points are its assertions (`ok 1 - should be equal`); a point with a
 *            subtest block whose points have no subtests of their own is a test, its leaf points are assertions,
 *            and a point whose block holds further subtests is a container (a describe, or the file).
 *   Perl     plain points are tests; `subtest` works like node-tap.
 * So a point with a YAML type is a test when the type is `test`; otherwise a point with a block is a test when no
 * point in its block has a block of its own, and a leaf point is a test unless its parent point was taken as a test.
 *
 * Keys. The name path is the chain of enclosing point names plus the point's own, joined by ` › ` as the describe
 * separator normaliser expects. When the top level point names a file (node-tap and Node 18 and 20 wrap each file
 * in a subtest named after its path), the file is the class and the chain below it the name, the Playwright and
 * Vitest shape (`file stem::chain`). Otherwise the chain is both class and name, the jest-junit default shape. Node
 * 22 writes no file subtest, and the `location` in its YAML is written for failures only, so it is not used for
 * keys: a key must not change between a run where the test passed and one where it failed.
 */
import { StringDecoder } from 'node:string_decoder';
import type { TestStatus } from '@testwitness/core';
import { nameKey, normaliseKey } from '@testwitness/core';
import type { ResultIndexData, TestRecord } from './records.js';
import { addRecord } from './records.js';

/** Longest line kept; longer lines (a minified stack in a YAML block) are skipped with a warning. */
export const TAP_MAX_LINE = 1024 * 1024;

export interface TapRecord {
  /** Name path from the outermost point to this one. */
  chain: string[];
  status: TestStatus;
}

interface Point {
  name: string;
  status: TestStatus;
  level: number;
  yamlType?: string;
  block?: ClosedFrame;
}

interface ClosedFrame {
  out: TapRecord[];
  cond: TapRecord[];
  points: number;
  nested: boolean;
}

interface Frame {
  level: number;
  name?: string;
  fresh: boolean;
  pending?: Point | undefined;
  out: TapRecord[];
  /** Leaf points kept only when the parent point turns out not to be a test. */
  cond: TapRecord[];
  points: number;
  /** Some point in this frame has a block of its own. */
  nested: boolean;
  plan?: number;
}

export interface TapSummary {
  version?: number;
  /** The top level plan, when there was one. */
  plan?: number;
  /** Test points at the top level. */
  points: number;
  bailedOut?: string;
  records: TapRecord[];
  warnings: string[];
}

const POINT = /^(not ok|ok)\b\s*(\d+)?\s*(?:-\s*)?(.*)$/i;
const PLAN = /^(\d+)\.\.(\d+)\s*(?:#\s*(.*))?$/;
const SUBTEST = /^#\s*Subtest\b:?\s*(.*)$/i;
const BAIL = /^Bail out!\s*(.*)$/i;
const VERSION = /^TAP version (\d+)\s*$/i;

/** Split a point description at the first unescaped `#`; the remainder is a directive when it starts with SKIP or TODO. */
export function splitDescription(rest: string): { name: string; directive?: 'skip' | 'todo' } {
  let name = '';
  let i = 0;
  for (; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '\\' && i + 1 < rest.length) {
      name += rest[i + 1];
      i++;
      continue;
    }
    if (ch === '#') break;
    name += ch;
  }
  const after = i < rest.length ? rest.slice(i + 1).trim() : '';
  const d = /^(skip|todo)/i.exec(after);
  const out: { name: string; directive?: 'skip' | 'todo' } = { name: name.trim() };
  if (d) out.directive = d[1]!.toLowerCase() as 'skip' | 'todo';
  return out;
}

function indentOf(line: string): { level: number; text: string; spaces: number } {
  let spaces = 0;
  let i = 0;
  for (; i < line.length; i++) {
    if (line[i] === ' ') spaces++;
    else if (line[i] === '\t') spaces += 4;
    else break;
  }
  return { level: Math.floor(spaces / 4), text: line.slice(i).replace(/\s+$/, ''), spaces };
}

/** A line based TAP parser. Feed lines with `line()`, then call `end()`. Never throws on any input. */
export class TapParser {
  private frames: Frame[] = [{ level: 0, fresh: true, out: [], cond: [], points: 0, nested: false }];
  private pendingName = new Map<number, string>();
  private yaml: { spaces: number; point: Point } | undefined;
  private lastPoint: { point: Point; spaces: number } | undefined;
  private done = false;
  private seenAny = false;
  readonly summary: TapSummary = { points: 0, records: [], warnings: [] };

  line(raw: string): void {
    if (this.done) return;
    const line = this.seenAny ? raw : raw.replace(/^\uFEFF/, '');
    this.seenAny = true;
    const { level, text, spaces } = indentOf(line);
    if (this.yaml) {
      if (text === '...' && spaces >= this.yaml.spaces) {
        this.yaml = undefined;
        return;
      }
      if (text === '' || spaces > this.yaml.spaces) return;
      if (spaces === this.yaml.spaces) {
        const m = /^type:\s*['"]?([A-Za-z]+)['"]?\s*$/.exec(text);
        if (m) this.yaml.point.yamlType = m[1]!;
        return;
      }
      // Dedented before the closing `...`: a malformed block. Stop skipping and read this line normally.
      this.yaml = undefined;
    }
    if (text === '') return;
    if (text === '---' && this.lastPoint && spaces > this.lastPoint.spaces) {
      this.yaml = { spaces, point: this.lastPoint.point };
      return;
    }
    this.lastPoint = undefined;
    let m: RegExpExecArray | null;
    if ((m = BAIL.exec(text))) {
      this.summary.bailedOut = m[1]!.trim();
      this.summary.warnings.push(`bailed out${m[1]!.trim() ? `: ${m[1]!.trim()}` : ''}; tests after it did not run`);
      this.finish();
      return;
    }
    if (level === 0 && (m = VERSION.exec(text))) {
      this.summary.version = Number(m[1]);
      return;
    }
    if ((m = SUBTEST.exec(text))) {
      this.heading(level, m[1]!.trim());
      return;
    }
    if (text.startsWith('#')) return;
    if ((m = PLAN.exec(text))) {
      const frame = this.frameAt(level);
      frame.plan = Number(m[2]);
      frame.fresh = false;
      return;
    }
    if ((m = POINT.exec(text))) {
      const { name, directive } = splitDescription(m[3] ?? '');
      const notOk = m[1]!.toLowerCase() === 'not ok';
      const status: TestStatus = directive ? 'skipped' : notOk ? 'failed' : 'passed';
      const point: Point = { name: name || `#${m[2] ?? '?'}`, status, level };
      this.addPoint(level, point);
      this.lastPoint = { point, spaces };
    }
    // Anything else (pragmas, stray output) is not TAP we need.
  }

  end(): TapSummary {
    this.finish();
    return this.summary;
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.yaml = undefined;
    while (this.frames.length > 1) this.closeOrphan();
    const root = this.frames[0]!;
    this.finalise(root);
    this.summary.records.push(...root.out, ...root.cond);
    this.summary.points = root.points;
    if (root.plan !== undefined) this.summary.plan = root.plan;
    if (this.summary.bailedOut === undefined) {
      if (root.plan === undefined) {
        if (root.points > 0) this.summary.warnings.push(`no plan line; ${root.points} test points read`);
      } else if (root.plan !== root.points) {
        this.summary.warnings.push(`plan 1..${root.plan} but ${root.points} test points`);
      }
    }
  }

  private top(): Frame {
    return this.frames[this.frames.length - 1]!;
  }

  /** The frame at `level`, opening fresh frames down to it when the line is deeper than the open ones. */
  private frameAt(level: number): Frame {
    while (this.top().level > level) this.closeOrphan();
    while (this.top().level < level) {
      const l = this.top().level + 1;
      const f: Frame = { level: l, fresh: true, out: [], cond: [], points: 0, nested: false };
      const n = this.pendingName.get(l);
      if (n !== undefined) {
        f.name = n;
        this.pendingName.delete(l);
      }
      this.frames.push(f);
    }
    return this.top();
  }

  private heading(level: number, name: string): void {
    if (level > this.top().level) {
      const f = this.frameAt(level);
      if (f.fresh && f.name === undefined) {
        f.name = name;
        return;
      }
    } else {
      while (this.top().level > level) this.closeOrphan();
      const f = this.top();
      if (level > 0 && f.fresh && f.name === undefined) {
        f.name = name;
        return;
      }
    }
    this.pendingName.set(level + 1, name);
  }

  private addPoint(level: number, point: Point): void {
    let block: ClosedFrame | undefined;
    while (this.top().level > level) {
      const f = this.frames.pop()!;
      if (f.level === level + 1) block = this.close(f);
      else this.adoptOrphan(f, this.top());
    }
    for (const l of [...this.pendingName.keys()]) if (l > level) this.pendingName.delete(l);
    const frame = this.frameAt(level);
    if (frame.pending) this.settle(frame, frame.pending);
    // A block with a plan and no points (`1..0`) ran nothing inside it; the point stands alone.
    if (block && block.points > 0) point.block = block;
    frame.pending = point;
    frame.points++;
    frame.fresh = false;
  }

  private close(f: Frame): ClosedFrame {
    this.finalise(f);
    return { out: f.out, cond: f.cond, points: f.points, nested: f.nested };
  }

  private finalise(f: Frame): void {
    if (f.pending) {
      this.settle(f, f.pending);
      f.pending = undefined;
    }
  }

  /** A frame closed without the point that should follow it (bail out, end of input, malformed nesting). */
  private closeOrphan(): void {
    const f = this.frames.pop()!;
    this.adoptOrphan(f, this.top());
  }

  private adoptOrphan(f: Frame, parent: Frame): void {
    this.finalise(f);
    const prefix = f.name !== undefined && f.name !== '' ? [f.name] : [];
    for (const r of [...f.out, ...f.cond]) parent.out.push({ chain: [...prefix, ...r.chain], status: r.status });
  }

  /** Decide which records a finished point contributes to its frame. */
  private settle(frame: Frame, p: Point): void {
    const block = p.block;
    if (block) frame.nested = true;
    if (!p.yamlType && !block) {
      frame.cond.push({ chain: [p.name], status: p.status });
      return;
    }
    const isTest = p.yamlType ? p.yamlType.toLowerCase() === 'test' : !block!.nested;
    if (isTest) frame.out.push({ chain: [p.name], status: p.status });
    if (!block) return;
    for (const r of block.out) frame.out.push({ chain: [p.name, ...r.chain], status: r.status });
    if (!isTest) for (const r of block.cond) frame.out.push({ chain: [p.name, ...r.chain], status: r.status });
  }
}

/** Parse TAP text held in memory (tests and tools). */
export function parseTap(text: string): TapSummary {
  const p = new TapParser();
  for (const l of text.split(/\r?\n/)) p.line(l);
  return p.end();
}

const FILE_LIKE = /\.(?:[cm]?[jt]sx?|py|t|pl|rb|go|java|kt)$/i;

/** True when a top level subtest name is a test file path rather than a describe title. */
export function looksLikeFile(name: string): boolean {
  return !/\s/.test(name) && (FILE_LIKE.test(name) || /[\\/]/.test(name));
}

/** The record a TAP name path becomes in the result index. */
export function tapTestRecord(r: TapRecord, source: string): TestRecord {
  let chain = r.chain;
  let file: string | undefined;
  if (chain.length > 1 && looksLikeFile(chain[0]!)) {
    file = chain[0]!;
    chain = chain.slice(1);
  }
  const name = chain.join(' › ');
  const rec: TestRecord = {
    key: file ? normaliseKey(file, name) : `${nameKey(name)}::${nameKey(name)}`,
    classname: file ?? name,
    name,
    status: r.status,
    reruns: 0,
    source,
  };
  if (file) rec.file = file;
  return rec;
}

/** Stream one TAP file into the index, line by line. */
export function readTapStream(stream: NodeJS.ReadableStream, source: string, data: ResultIndexData): Promise<void> {
  return new Promise((resolve) => {
    const parser = new TapParser();
    const decoder = new StringDecoder('utf8');
    let buf = '';
    let skippingLong = false;
    let longLines = 0;
    const feed = (text: string) => {
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (skippingLong) skippingLong = false;
        else parser.line(line);
      }
      if (buf.length > TAP_MAX_LINE) {
        buf = '';
        if (!skippingLong) longLines++;
        skippingLong = true;
      }
    };
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        if (!err) {
          const rest = decoder.end();
          if (rest) feed(rest);
          if (buf && !skippingLong) parser.line(buf.replace(/\r$/, ''));
        }
        const summary = parser.end();
        if (err) data.warnings.push(`${source}: ${err.message}`);
        if (longLines) data.warnings.push(`${source}: ${longLines} line${longLines === 1 ? '' : 's'} over ${TAP_MAX_LINE / 1024} KB skipped`);
        for (const w of summary.warnings) data.warnings.push(`${source}: ${w}`);
        if (summary.records.length === 0) data.warnings.push(`${source}: no TAP test points found`);
        for (const r of summary.records) addRecord(data, tapTestRecord(r, source));
      } catch (e) {
        data.warnings.push(`${source}: ${(e as Error).message}`);
      }
      data.sources.push(source);
      data.formats.add('tap');
      resolve();
    };
    stream.on('data', (chunk: Buffer | string) => {
      try {
        feed(typeof chunk === 'string' ? chunk : decoder.write(chunk));
      } catch (e) {
        data.warnings.push(`${source}: ${(e as Error).message}`);
      }
    });
    stream.on('error', (e: Error) => finish(e));
    stream.on('end', () => finish());
  });
}
