/**
 * Streaming readers for line coverage: lcov (`lcov.info`), Cobertura XML (coverage.py `coverage.xml`, and the
 * Cobertura writers of Istanbul, gcovr and others) and JaCoCo XML. Like the JUnit reader they stream, read only
 * what every producer agrees on, and never fetch anything: the DOCTYPE of a Cobertura or JaCoCo report is not
 * resolved. Only line hits are read; branch data is ignored.
 */
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';
import type { CoverageEvidence, FileCoverage } from '../types.js';

export const COVERAGE_MAX_FILES = 200;
export const COVERAGE_MAX_BYTES = 50 * 1024 * 1024;

export type CoverageFormat = 'lcov' | 'cobertura' | 'jacoco';

interface MutableFileCoverage {
  instrumented: Set<number>;
  executed: Set<number>;
}

export interface CoverageData {
  files: Map<string, MutableFileCoverage>;
  sources: string[];
  warnings: string[];
  bytes: number;
  capped: boolean;
}

export function emptyCoverage(): CoverageData {
  return { files: new Map(), sources: [], warnings: [], bytes: 0, capped: false };
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:\//.test(p);
}

/** Forward slashes, no file:// scheme (file:///C:/x is C:/x), no `./` segments, no doubled slashes. */
function clean(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^file:\/\/\/(?=[A-Za-z]:\/)/i, '')
    .replace(/^file:\/\//i, '')
    .replace(/\/\.\//g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

/** A Windows path as written: a drive letter, a UNC share (\\server\share) or a file URL to a drive. */
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|file:\/\/\/[A-Za-z]:)/i;

/**
 * The part of `p` under the directory `dir`, or undefined. Both are cleaned. Windows paths compare without regard to
 * case, as the file system does: Istanbul writes c:\repo while the runner's working directory is C:\repo.
 */
function under(p: string, dir: string, windows: boolean): string | undefined {
  const same = (a: string, b: string): boolean => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(p, dir)) return '';
  if (p.length > dir.length && p[dir.length] === '/' && same(p.slice(0, dir.length), dir)) return p.slice(dir.length + 1);
  return undefined;
}

/**
 * Make a report path repository relative when it can be. An absolute path under `root` loses the root; a relative
 * path joined to a Cobertura source root under `root` becomes relative to the repository. Anything else is kept
 * (cleaned) and matched by suffix at lookup time, which covers reports written on a CI runner with another
 * checkout path. Backslashes, drive letter case and file:// URLs are normalised, so a report written on Windows
 * gives the same paths as one written on Linux.
 */
export function normaliseCoveragePath(raw: string, root: string | undefined, sourceRoots: string[] = []): string {
  const p = clean(raw.trim());
  const r = root ? clean(root.trim()).replace(/\/$/, '') : undefined;
  const windows = WINDOWS_PATH.test(raw.trim()) || (root !== undefined && WINDOWS_PATH.test(root.trim()));
  if (isAbsolute(p)) {
    const rel = r ? under(p, r, windows) : undefined;
    return rel ? rel : p;
  }
  for (const s of sourceRoots) {
    const sr = clean(s.trim()).replace(/\/$/, '');
    if (!sr || sr === '.') continue;
    const rel = r && isAbsolute(sr) ? under(sr, r, windows || WINDOWS_PATH.test(s.trim())) : undefined;
    if (rel !== undefined) return rel ? `${rel}/${p}` : p;
    if (!isAbsolute(sr)) return `${sr}/${p}`;
  }
  return p;
}

function fileOf(data: CoverageData, path: string): MutableFileCoverage {
  let f = data.files.get(path);
  if (!f) {
    f = { instrumented: new Set(), executed: new Set() };
    data.files.set(path, f);
  }
  return f;
}

function record(f: MutableFileCoverage, line: number, hits: number): void {
  if (!Number.isInteger(line) || line < 1) return;
  f.instrumented.add(line);
  if (hits > 0) f.executed.add(line);
}

/** lcov tracefile: SF, DA and end_of_record are the only records read. */
export async function readLcovStream(stream: NodeJS.ReadableStream, source: string, data: CoverageData, root?: string): Promise<void> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let current: MutableFileCoverage | undefined;
  let records = 0;
  for await (const line of rl) {
    if (line.startsWith('SF:')) {
      current = fileOf(data, normaliseCoveragePath(line.slice(3), root));
      records++;
    } else if (line.startsWith('DA:') && current) {
      const [ln, hits] = line.slice(3).split(',');
      record(current, Number(ln), Number(hits));
    } else if (line.startsWith('end_of_record')) current = undefined;
  }
  if (!records) data.warnings.push(`${source}: no SF records found`);
  data.sources.push(source);
}

/** Cobertura and JaCoCo XML, told apart by the root element. */
export function readCoverageXmlStream(stream: NodeJS.ReadableStream, source: string, data: CoverageData, root?: string): Promise<CoverageFormat | undefined> {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser({ xmlns: false, position: false });
    const stack: string[] = [];
    let format: CoverageFormat | undefined;
    const sourceRoots: string[] = [];
    let sourceText: string | undefined;
    let current: MutableFileCoverage | undefined;
    let pkg = '';
    let files = 0;
    parser.on('error', (e) => {
      data.warnings.push(`${source}: ${e.message}`);
    });
    parser.on('opentag', (tag: SaxesTagPlain) => {
      const name = tag.name;
      const a = tag.attributes as Record<string, string>;
      if (!stack.length) format = name === 'coverage' ? 'cobertura' : name === 'report' ? 'jacoco' : undefined;
      stack.push(name);
      if (format === 'cobertura') {
        if (name === 'source') sourceText = '';
        else if (name === 'class' && a['filename'] !== undefined) {
          current = fileOf(data, normaliseCoveragePath(a['filename'], root, sourceRoots));
          files++;
        } else if (name === 'line' && current && stack[stack.length - 2] === 'lines' && stack[stack.length - 3] === 'class') {
          record(current, Number(a['number']), Number(a['hits'] ?? 0));
        }
      } else if (format === 'jacoco') {
        if (name === 'package') pkg = a['name'] ?? '';
        else if (name === 'sourcefile' && a['name'] !== undefined) {
          current = fileOf(data, normaliseCoveragePath(pkg ? `${pkg}/${a['name']}` : a['name'], undefined));
          files++;
        } else if (name === 'line' && current && stack[stack.length - 2] === 'sourcefile') {
          record(current, Number(a['nr']), Number(a['ci'] ?? 0));
        }
      }
    });
    parser.on('text', (t: string) => {
      if (sourceText !== undefined) sourceText += t;
    });
    parser.on('closetag', (tag: SaxesTagPlain) => {
      stack.pop();
      if (format === 'cobertura' && tag.name === 'source' && sourceText !== undefined) {
        sourceRoots.push(sourceText.trim());
        sourceText = undefined;
      } else if ((format === 'cobertura' && tag.name === 'class') || (format === 'jacoco' && tag.name === 'sourcefile')) current = undefined;
      else if (format === 'jacoco' && tag.name === 'package') pkg = '';
    });
    const decoder = new StringDecoder('utf8');
    stream.on('error', reject);
    stream.on('data', (chunk: Buffer | string) => {
      try {
        parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk));
      } catch (e) {
        data.warnings.push(`${source}: ${(e as Error).message}`);
      }
    });
    stream.on('end', () => {
      try {
        const rest = decoder.end();
        if (rest) parser.write(rest);
        parser.close();
      } catch (e) {
        data.warnings.push(`${source}: ${(e as Error).message}`);
      }
      if (!format) data.warnings.push(`${source}: not a Cobertura or JaCoCo report`);
      else if (!files) data.warnings.push(`${source}: no source files in the report`);
      data.sources.push(source);
      resolve(format);
    });
  });
}

/** Sniff the first bytes: XML root element, or lcov records. */
export function sniffCoverageFormat(head: string): CoverageFormat | undefined {
  const xml = head.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const root = /<\s*([\w:-]+)/.exec(xml)?.[1];
  if (root === 'coverage') return 'cobertura';
  if (root === 'report') return 'jacoco';
  if (/^(TN|SF|DA|FN|LF|LH):/m.test(head)) return 'lcov';
  return undefined;
}

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

/** Read coverage reports from disk, within the file and byte caps. */
export async function readCoverageFiles(paths: string[], root?: string, caps: { maxFiles?: number; maxBytes?: number } = {}): Promise<CoverageData> {
  const maxFiles = caps.maxFiles ?? COVERAGE_MAX_FILES;
  const maxBytes = caps.maxBytes ?? COVERAGE_MAX_BYTES;
  const data = emptyCoverage();
  let read = 0;
  for (const p of paths) {
    if (read >= maxFiles) {
      data.capped = true;
      data.warnings.push(`coverage: stopped after ${maxFiles} report files; ${paths.length - read} not read`);
      break;
    }
    // A file that vanished, a directory, or a read error is a note, never a failed check.
    try {
      const size = (await stat(p)).size;
      if (data.bytes + size > maxBytes) {
        data.capped = true;
        data.warnings.push(`coverage: ${p} not read, it would pass the ${Math.round(maxBytes / 1048576)} MB cap`);
        continue;
      }
      const format = sniffCoverageFormat(await readHead(p));
      if (!format) {
        data.warnings.push(`${p}: not an lcov, Cobertura or JaCoCo report`);
        continue;
      }
      data.bytes += size;
      read++;
      if (format === 'lcov') await readLcovStream(createReadStream(p), p, data, root);
      else await readCoverageXmlStream(createReadStream(p), p, data, root);
    } catch (e) {
      data.warnings.push(`${p}: not read (${(e as Error).message})`);
    }
  }
  return data;
}

/** Read a report from a string (tests and tools). */
export async function readCoverageString(text: string, source = 'inline', root?: string): Promise<CoverageData> {
  const data = emptyCoverage();
  const { Readable } = await import('node:stream');
  const format = sniffCoverageFormat(text.slice(0, 4096));
  if (format === 'lcov') await readLcovStream(Readable.from([text]), source, data, root);
  else if (format) await readCoverageXmlStream(Readable.from([text]), source, data, root);
  else data.warnings.push(`${source}: not an lcov, Cobertura or JaCoCo report`);
  return data;
}

/** Adapt read data to the core CoverageEvidence interface, with suffix matching for paths it could not make relative. */
export function toCoverageEvidence(data: CoverageData): CoverageEvidence {
  const byBase = new Map<string, string[]>();
  let instrumented = 0;
  let executed = 0;
  for (const [k, f] of data.files) {
    const b = k.split('/').pop() ?? k;
    (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(k);
    instrumented += f.instrumented.size;
    executed += f.executed.size;
  }
  const lookup = (path: string): FileCoverage | undefined => {
    const p = clean(path);
    const exact = data.files.get(p);
    if (exact) return exact;
    const cands = (byBase.get(p.split('/').pop() ?? p) ?? []).filter((k) => k.endsWith(`/${p}`) || p.endsWith(`/${k}`));
    if (!cands.length) return undefined;
    cands.sort((a, b) => b.length - a.length);
    return data.files.get(cands[0]!);
  };
  return { sources: data.sources, files: data.files.size, linesInstrumented: instrumented, linesExecuted: executed, warnings: data.warnings, lookup };
}
