/**
 * Readers for mutation testing reports: the Stryker mutation-testing-elements JSON report (`mutation.json`, written by
 * StrykerJS, Stryker.NET and Stryker4s with the json reporter) and PIT `mutations.xml`. The engine never runs a mutation
 * tool; these readers only read what the opt in mutation job wrote (docs/mutation-on-request.md).
 *
 * PIT XML is streamed with saxes, and its DOCTYPE, if any, is never resolved. The Stryker report is one JSON document
 * with no record boundary, so it is read whole, within the same byte cap, and parsed with JSON.parse; nothing in it is
 * evaluated. mutmut is not read: its machine readable outputs (the `mutants/*.meta` files and `mutmut
 * export-cicd-stats`) carry no line numbers and no killing tests, and its documentation describes no format that does.
 *
 * Each mutant is attributed to the line it starts on. Outcomes: killed and timed out count as killed (the tests noticed
 * the change), survived, and no coverage. Compile errors, runtime errors, ignored, pending and non viable mutants are
 * not counted anywhere. Test names are normalised to the `classKey::nameKey` keys the JUnit reader builds.
 */
import { XmlErrors } from '../xml-errors.js';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';
import type { FileMutation, LineMutation, MutationEvidence } from '../types.js';
import { normaliseCoveragePath } from '../coverage/reader.js';
import { nameKey, normaliseKey } from '../evidence/normalise.js';

export const MUTATION_MAX_FILES = 200;
export const MUTATION_MAX_BYTES = 50 * 1024 * 1024;

export type MutationFormat = 'stryker' | 'pit';

interface MutableLine {
  total: number;
  killed: number;
  survived: number;
  noCoverage: number;
  killedBy: Set<string>;
  coveredBy: Set<string>;
}

export interface MutationData {
  files: Map<string, Map<number, MutableLine>>;
  sources: string[];
  tools: Set<MutationFormat>;
  warnings: string[];
  bytes: number;
  capped: boolean;
  /** At least one report named the tests that killed its mutants. */
  testIds: boolean;
  /** Tests the mutation run listed (Stryker testFiles); undefined when no report lists them. */
  tests?: Set<string>;
  killers: Set<string>;
  mutants: number;
  killed: number;
  survived: number;
  noCoverage: number;
}

export function emptyMutation(): MutationData {
  return { files: new Map(), sources: [], tools: new Set(), warnings: [], bytes: 0, capped: false, testIds: false, killers: new Set(), mutants: 0, killed: 0, survived: 0, noCoverage: 0 };
}

type Outcome = 'killed' | 'survived' | 'noCoverage';

const STRYKER_STATUS: Record<string, Outcome | undefined> = { Killed: 'killed', Timeout: 'killed', Survived: 'survived', NoCoverage: 'noCoverage' };
const PIT_STATUS: Record<string, Outcome | undefined> = { KILLED: 'killed', TIMED_OUT: 'killed', MEMORY_ERROR: 'killed', SURVIVED: 'survived', NO_COVERAGE: 'noCoverage' };

function record(data: MutationData, path: string, line: number, outcome: Outcome, killedBy: Iterable<string>, coveredBy: Iterable<string>): void {
  if (!Number.isInteger(line) || line < 1) return;
  let file = data.files.get(path);
  if (!file) {
    file = new Map();
    data.files.set(path, file);
  }
  let l = file.get(line);
  if (!l) {
    l = { total: 0, killed: 0, survived: 0, noCoverage: 0, killedBy: new Set(), coveredBy: new Set() };
    file.set(line, l);
  }
  l.total++;
  l[outcome]++;
  data.mutants++;
  data[outcome]++;
  for (const k of killedBy) {
    l.killedBy.add(k);
    data.killers.add(k);
  }
  for (const k of coveredBy) l.coveredBy.add(k);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read a Stryker mutation-testing-elements report: `files` keyed by path with `mutants` (location.start.line, status,
 * killedBy, coveredBy), and `testFiles` keyed by test file path or class name with `tests` ({ id, name }). A killedBy or
 * coveredBy id that `testFiles` does not define is ignored, because an opaque id cannot be matched to a test.
 */
export function readStrykerJson(text: string, source: string, data: MutationData, root?: string): void {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    data.warnings.push(`${source}: not valid JSON (${(e as Error).message})`);
    return;
  }
  if (!isRecord(doc) || !isRecord(doc['files'])) {
    data.warnings.push(`${source}: not a Stryker mutation report (no files object)`);
    return;
  }
  const projectRoot = typeof doc['projectRoot'] === 'string' ? [doc['projectRoot']] : [];
  const keyOf = new Map<string, string>();
  if (isRecord(doc['testFiles'])) {
    data.tests ??= new Set();
    for (const [file, tf] of Object.entries(doc['testFiles'])) {
      if (!isRecord(tf) || !Array.isArray(tf['tests'])) continue;
      for (const t of tf['tests']) {
        if (!isRecord(t) || typeof t['id'] !== 'string' || typeof t['name'] !== 'string') continue;
        // An empty key means the framework does not group tests by file; the name then carries the whole path.
        const key = file ? normaliseKey(file, t['name']) : nameKey(t['name']);
        keyOf.set(t['id'], key);
        data.tests.add(key);
      }
    }
    if (keyOf.size) data.testIds = true;
  }
  const keys = (ids: unknown): string[] => (Array.isArray(ids) ? ids.flatMap((id) => (typeof id === 'string' && keyOf.has(id) ? [keyOf.get(id)!] : [])) : []);
  let mutants = 0;
  for (const [rawPath, fr] of Object.entries(doc['files'])) {
    if (!isRecord(fr) || !Array.isArray(fr['mutants'])) continue;
    const path = normaliseCoveragePath(rawPath, root, projectRoot);
    for (const m of fr['mutants']) {
      if (!isRecord(m) || !isRecord(m['location']) || !isRecord(m['location']['start'])) continue;
      // Own keys only: a status of `constructor` or `__proto__` would otherwise find Object.prototype's members.
      const status = String(m['status']);
      const outcome = Object.hasOwn(STRYKER_STATUS, status) ? STRYKER_STATUS[status] : undefined;
      if (!outcome) continue;
      mutants++;
      record(data, path, Number(m['location']['start']['line']), outcome, outcome === 'killed' ? keys(m['killedBy']) : [], keys(m['coveredBy']));
    }
  }
  if (!mutants) data.warnings.push(`${source}: no killed, survived or uncovered mutants in the report`);
  data.tools.add('stryker');
  data.sources.push(source);
}

/**
 * Key of a PIT test name, as the JUnit reader would key the same test:
 *   JUnit 5 unique id  demo.CartTest.[engine:junit-jupiter]/[class:demo.CartTest]/[nested-class:Empty]/[method:adds()]
 *   JUnit 4            demo.CartTest.adds(demo.CartTest)
 *   TestNG and others  demo.CartTest.adds
 */
/** Longest PIT test name read. Real unique ids are well under 1 KB; the segment regex is quadratic on a long hostile one. */
export const PIT_TEST_NAME_MAX = 4096;

export function pitTestKey(raw: string): string | undefined {
  const s = raw.trim();
  if (!s || s.length > PIT_TEST_NAME_MAX) return undefined;
  if (s.includes('[engine:')) {
    const segs = [...s.matchAll(/\[([\w-]+):([^\]]*)\]/g)].map((m) => ({ type: m[1]!, value: m[2]! }));
    const cls = segs.filter((x) => x.type === 'class').pop()?.value;
    if (!cls) return undefined;
    const nested = segs.filter((x) => x.type === 'nested-class').map((x) => x.value);
    const method = segs.find((x) => x.type === 'method' || x.type === 'test-template' || x.type === 'test-factory')?.value;
    if (!method) return undefined;
    const simple = [cls.split('.').pop()!, ...nested].join('$');
    return `${simple.toLowerCase()}::${nameKey(method)}`;
  }
  const j4 = /^(.*)\.([^.()]+)\(([^()]*)\)$/.exec(s);
  if (j4) return normaliseKey(j4[3] || j4[1]!, j4[2]!);
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return normaliseKey(s.slice(0, dot), s.slice(dot + 1));
}

/** PIT mutations.xml: one `mutation` element per mutant with status, sourceFile, mutatedClass, lineNumber and killingTest (or killingTests and succeedingTests with fullMutationMatrix). */
export function readPitXmlStream(stream: NodeJS.ReadableStream, source: string, data: MutationData, root?: string): Promise<void> {
  void root; // PIT names classes, not paths; the package path is matched by suffix at lookup time.
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser({ xmlns: false, position: false });
    const errors = new XmlErrors(source, data.warnings);
    const stack: string[] = [];
    let isPit = false;
    let mutants = 0;
    let cur: { status: string; fields: Record<string, string> } | undefined;
    let field: string | undefined;
    parser.on('error', (e) => errors.add(e.message));
    parser.on('opentag', (tag: SaxesTagPlain) => {
      if (!stack.length) isPit = tag.name === 'mutations';
      stack.push(tag.name);
      if (!isPit) return;
      if (tag.name === 'mutation' && stack.length === 2) cur = { status: String((tag.attributes as Record<string, string>)['status'] ?? ''), fields: {} };
      else if (cur && stack.length === 3) {
        field = tag.name;
        cur.fields[field] = '';
      }
    });
    parser.on('text', (t: string) => {
      if (cur && field && stack.length === 3) cur.fields[field] += t;
    });
    parser.on('closetag', (tag: SaxesTagPlain) => {
      stack.pop();
      if (cur && stack.length === 2 && tag.name === field) field = undefined;
      if (cur && tag.name === 'mutation' && stack.length === 1) {
        const f = cur.fields;
        const pitStatus = cur.status.trim().toUpperCase();
        const outcome = Object.hasOwn(PIT_STATUS, pitStatus) ? PIT_STATUS[pitStatus] : undefined;
        const cls = outerClass((f['mutatedClass'] ?? '').trim());
        const file = (f['sourceFile'] ?? '').trim();
        if (outcome && file) {
          const pkg = cls.includes('.') ? cls.slice(0, cls.lastIndexOf('.')).replace(/\./g, '/') : '';
          const killing = [f['killingTest'] ?? '', ...(f['killingTests'] ?? '').split('|')].flatMap((t) => {
            const k = pitTestKey(t);
            return k ? [k] : [];
          });
          const succeeding = (f['succeedingTests'] ?? '').split('|').flatMap((t) => {
            const k = pitTestKey(t);
            return k ? [k] : [];
          });
          if (killing.length) data.testIds = true;
          mutants++;
          // Without fullMutationMatrix PIT names one killing test and no covering ones, so coverage is only recorded
          // when the matrix elements are there; otherwise the rules fall back to names and imports.
          const matrix = f['killingTests'] !== undefined || f['succeedingTests'] !== undefined;
          record(data, normaliseCoveragePath(pkg ? `${pkg}/${file}` : file, undefined), Number((f['lineNumber'] ?? '').trim()), outcome, outcome === 'killed' ? killing : [], matrix ? [...killing, ...succeeding] : []);
        }
        cur = undefined;
      }
    });
    const decoder = new StringDecoder('utf8');
    stream.on('error', reject);
    stream.on('data', (chunk: Buffer | string) => {
      try {
        parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk));
      } catch (e) {
        errors.add((e as Error).message);
      }
    });
    stream.on('end', () => {
      try {
        const rest = decoder.end();
        if (rest) parser.write(rest);
        parser.close();
      } catch (e) {
        errors.add((e as Error).message);
      }
      errors.done();
      if (!isPit) data.warnings.push(`${source}: not a PIT mutations.xml report`);
      else {
        if (!mutants) data.warnings.push(`${source}: no killed, survived or uncovered mutations in the report`);
        data.tools.add('pit');
        data.sources.push(source);
      }
      resolve();
    });
  });
}

/** What the first bytes say: a Stryker JSON report, a PIT XML report, or a mutmut file that cannot be read. */
export function sniffMutationFormat(head: string): MutationFormat | 'mutmut' | undefined {
  const t = head.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('{')) {
    if (/"exit_code_by_key"|"no_tests"\s*:|"check_was_interrupted_by_user"/.test(t)) return 'mutmut';
    if (/"(files|schemaVersion|testFiles|thresholds)"\s*:/.test(t)) return 'stryker';
    return undefined;
  }
  const xml = t.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  if (/^\s*<\s*mutations[\s>/]/.test(xml)) return 'pit';
  return undefined;
}

const MUTMUT_NOTE = 'is mutmut output; mutmut results carry no line numbers or killing tests, so they are not read (see docs/mutation-on-request.md)';

async function readHead(path: string, bytes = 4096): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/** Read mutation reports from disk, within the file and byte caps. */
export async function readMutationFiles(paths: string[], root?: string, caps: { maxFiles?: number; maxBytes?: number } = {}): Promise<MutationData> {
  const maxFiles = caps.maxFiles ?? MUTATION_MAX_FILES;
  const maxBytes = caps.maxBytes ?? MUTATION_MAX_BYTES;
  const data = emptyMutation();
  let read = 0;
  for (const p of paths) {
    if (read >= maxFiles) {
      data.capped = true;
      data.warnings.push(`mutation: stopped after ${maxFiles} report files; ${paths.length - read} not read`);
      break;
    }
    // A file that vanished, a directory, or a read error is a note, never a failed check.
    try {
      const size = (await stat(p)).size;
      if (data.bytes + size > maxBytes) {
        data.capped = true;
        data.warnings.push(`mutation: ${p} not read, it would pass the ${Math.round(maxBytes / 1048576)} MB cap`);
        continue;
      }
      const format = sniffMutationFormat(await readHead(p));
      if (format === 'mutmut') {
        data.warnings.push(`${p} ${MUTMUT_NOTE}`);
        continue;
      }
      if (!format) {
        data.warnings.push(`${p}: not a Stryker JSON or PIT mutations.xml report`);
        continue;
      }
      data.bytes += size;
      read++;
      if (format === 'stryker') readStrykerJson(await readFile(p, 'utf8'), p, data, root);
      else await readPitXmlStream(createReadStream(p), p, data, root);
    } catch (e) {
      data.warnings.push(`${p}: not read (${(e as Error).message})`);
    }
  }
  return data;
}

/** Read a report from a string (tests and tools). */
export async function readMutationString(text: string, source = 'inline', root?: string, into: MutationData = emptyMutation()): Promise<MutationData> {
  const format = sniffMutationFormat(text.slice(0, 4096));
  if (format === 'stryker') readStrykerJson(text, source, into, root);
  else if (format === 'pit') {
    const { Readable } = await import('node:stream');
    await readPitXmlStream(Readable.from([text]), source, into, root);
  } else if (format === 'mutmut') into.warnings.push(`${source} ${MUTMUT_NOTE}`);
  else into.warnings.push(`${source}: not a Stryker JSON or PIT mutations.xml report`);
  return into;
}

function clean(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

/** Adapt read data to the core MutationEvidence interface, with suffix matching for paths it could not make relative. */
export function toMutationEvidence(data: MutationData): MutationEvidence {
  const byBase = new Map<string, string[]>();
  for (const k of data.files.keys()) {
    const b = k.split('/').pop() ?? k;
    (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(k);
  }
  const cache = new Map<string, FileMutation>();
  const view = (key: string): FileMutation => {
    let v = cache.get(key);
    if (!v) {
      v = { lines: data.files.get(key)! as ReadonlyMap<number, LineMutation> };
      cache.set(key, v);
    }
    return v;
  };
  const lookup = (path: string): FileMutation | undefined => {
    const p = clean(path);
    if (data.files.has(p)) return view(p);
    const cands = (byBase.get(p.split('/').pop() ?? p) ?? []).filter((k) => k.endsWith(`/${p}`) || p.endsWith(`/${k}`));
    if (!cands.length) return undefined;
    cands.sort((a, b) => b.length - a.length);
    return view(cands[0]!);
  };
  const warnings = [...data.warnings];
  if (data.sources.length && !data.testIds) {
    warnings.push('The mutation reports name no killing tests, so M002 is silent and new tests are not graded by what they kill. StrykerJS records them with coverageAnalysis perTest; PIT writes killingTest in mutations.xml.');
  }
  return {
    sources: data.sources,
    tools: [...data.tools].sort(),
    files: data.files.size,
    mutants: data.mutants,
    killed: data.killed,
    survived: data.survived,
    noCoverage: data.noCoverage,
    testIds: data.testIds,
    ...(data.tests ? { tests: data.tests } : {}),
    killers: data.killers,
    warnings,
    lookup,
  };
}

/**
 * The outer class of `Outer$Inner$1`: the name up to the first `$`. Same result as `.replace(/\$.*$/, '')`, which
 * rescanned the rest of the name from every `$` when a line break followed (quadratic on a hostile report).
 */
export function outerClass(cls: string): string {
  const lastBreak = Math.max(cls.lastIndexOf('\n'), cls.lastIndexOf('\r'), cls.lastIndexOf('\u2028'), cls.lastIndexOf('\u2029'));
  const i = cls.indexOf('$', lastBreak + 1);
  return i < 0 ? cls : cls.slice(0, i);
}
