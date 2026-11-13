import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { TestStatus } from '@testwitness/core';
import { normaliseKey } from '@testwitness/core';
import type { ResultFormat, ResultIndexData, TestRecord } from './records.js';
import { addRecord, emptyIndex, finaliseTotals } from './records.js';
import { readTapStream } from './tap.js';
import { readJsonResults } from './json.js';

export * from './records.js';

const FAIL_CHILDREN = new Set(['failure']);
const ERROR_CHILDREN = new Set(['error']);
const SKIP_CHILDREN = new Set(['skipped']);
const FLAKY_CHILDREN = new Set(['flakyFailure', 'flakyError']);
const RERUN_CHILDREN = new Set(['rerunFailure', 'rerunError']);

/**
 * Stream one JUnit XML file into the index. Only the elements and attributes
 * every producer agrees on are read: testsuite/@name, testcase/@name,
 * testcase/@classname, testcase/@file, and the child elements skipped,
 * failure, error, flakyFailure, flakyError, rerunFailure, rerunError.
 */
export function readJunitStream(stream: NodeJS.ReadableStream, source: string, data: ResultIndexData): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser({ xmlns: false, position: false });
    const suiteStack: string[] = [];
    interface Current { classname: string; name: string; file?: string; time?: string; status: TestStatus; reruns: number }
    let current: Current | undefined;
    let depthInsideCase = 0;
    let sawTestcase = false;

    parser.on('error', (e) => {
      data.warnings.push(`${source}: ${e.message}`);
      // saxes can continue after some errors; keep going.
    });

    parser.on('opentag', (tag: SaxesTagPlain) => {
      const name = tag.name;
      if (current) {
        depthInsideCase++;
        if (FAIL_CHILDREN.has(name)) current.status = 'failed';
        else if (ERROR_CHILDREN.has(name) && current.status !== 'failed') current.status = 'error';
        else if (SKIP_CHILDREN.has(name) && current.status === 'passed') current.status = 'skipped';
        else if (FLAKY_CHILDREN.has(name)) {
          current.reruns++;
          if (current.status === 'passed') current.status = 'flaky';
        } else if (RERUN_CHILDREN.has(name)) {
          current.reruns++;
        }
        return;
      }
      if (name === 'testsuite') {
        suiteStack.push(tag.attributes['name'] ?? '');
      } else if (name === 'testcase') {
        sawTestcase = true;
        const rec: Current = {
          classname: tag.attributes['classname'] ?? suiteStack[suiteStack.length - 1] ?? '',
          name: tag.attributes['name'] ?? '',
          status: 'passed',
          reruns: 0,
        };
        if (tag.attributes['file'] !== undefined) rec.file = tag.attributes['file'];
        if (tag.attributes['time'] !== undefined) rec.time = tag.attributes['time'];
        current = rec;
        depthInsideCase = 0;
      }
    });

    parser.on('closetag', (tag: SaxesTagPlain) => {
      if (current) {
        if (depthInsideCase > 0) {
          depthInsideCase--;
          return;
        }
        if (tag.name === 'testcase') {
          const key = normaliseKey(current.classname, current.name);
          const rec: TestRecord = {
            key,
            classname: current.classname,
            name: current.name,
            status: current.status,
            reruns: current.reruns,
            source,
          };
          if (current.file !== undefined) rec.file = current.file;
          if (current.time !== undefined) {
            const t = Number(current.time);
            if (!Number.isNaN(t)) rec.timeMs = Math.round(t * 1000);
          }
          addRecord(data, rec);
          current = undefined;
        }
        return;
      }
      if (tag.name === 'testsuite') suiteStack.pop();
    });

    // Buffers are decoded with a stateful decoder so a multibyte character that
    // straddles two read chunks (jest-junit titles use U+203A) is not turned into U+FFFD.
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
      if (!sawTestcase) data.warnings.push(`${source}: no testcase elements found`);
      data.sources.push(source);
      data.formats.add('junit-xml');
      resolve();
    });
  });
}

/** Whole file JSON results are read within this cap per file; larger files are refused with a note. */
export const RESULTS_JSON_MAX_BYTES = 50 * 1024 * 1024;

/** Bytes read from the start of a file to tell its format. */
const SNIFF_BYTES = 4096;

/**
 * Tell a results file's format from its first bytes: `<` is XML (JUnit), `{` is JSON (the reporter is told from the
 * parsed shape), and TAP starts with a version line, a plan, a test point, a subtest heading or a bail out, after
 * any comment lines. Undefined when it is none of these.
 */
export function sniffResultsFormat(head: string): 'junit-xml' | 'json' | 'tap' | undefined {
  const text = head.replace(/^\uFEFF/, '');
  const first = text.trimStart()[0];
  if (first === '<') return 'junit-xml';
  if (first === '{') return 'json';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^TAP version \d+$/i.test(line) || /^\d+\.\.\d+(\s*#.*)?$/.test(line) || /^(not )?ok\b/i.test(line) || /^#\s*Subtest\b/i.test(line) || /^Bail out!/i.test(line)) return 'tap';
    if (line.startsWith('#')) continue;
    return undefined;
  }
  return undefined;
}

async function readHead(path: string): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
    return new StringDecoder('utf8').write(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

const NOT_RESULTS = 'not JUnit XML, TAP, or the JSON output of Jest, Vitest, pytest-json-report or Playwright; not read';

/** Read one results file of any supported format into the index. Never throws for a bad file; it adds a warning. */
export async function readResultsFile(path: string, data: ResultIndexData, caps: { maxJsonBytes?: number } = {}): Promise<ResultFormat | undefined> {
  const maxJson = caps.maxJsonBytes ?? RESULTS_JSON_MAX_BYTES;
  try {
    const size = (await stat(path)).size;
    const kind = sniffResultsFormat(await readHead(path));
    if (kind === 'junit-xml') {
      await readJunitStream(createReadStream(path), path, data);
      return 'junit-xml';
    }
    if (kind === 'tap') {
      await readTapStream(createReadStream(path), path, data);
      return 'tap';
    }
    if (kind === 'json') {
      if (size > maxJson) {
        data.warnings.push(`${path}: ${size} bytes, over the ${Math.round(maxJson / 1048576)} MB cap for JSON results; not read`);
        return undefined;
      }
      let doc: unknown;
      try {
        doc = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
      } catch (e) {
        data.warnings.push(`${path}: not valid JSON (${(e as Error).message.slice(0, 120)}); not read`);
        return undefined;
      }
      const format = readJsonResults(doc, path, data);
      if (!format) data.warnings.push(`${path}: ${NOT_RESULTS}`);
      return format;
    }
    data.warnings.push(`${path}: ${NOT_RESULTS}`);
    return undefined;
  } catch (e) {
    data.warnings.push(`${path}: ${(e as Error).message}`);
    return undefined;
  }
}

/** Results files read at most in one run. */
export const RESULTS_MAX_FILES = 1000;
/** Bytes of results files read at most in one run. XML and TAP stream, so memory stays flat; the cap bounds time. */
export const RESULTS_MAX_BYTES = 500 * 1024 * 1024;

/** Read results files of any supported format, told apart by content, within the file and byte caps. */
export async function readResultsFiles(paths: string[], caps: { maxJsonBytes?: number; maxFiles?: number; maxBytes?: number } = {}): Promise<ResultIndexData> {
  const maxFiles = caps.maxFiles ?? RESULTS_MAX_FILES;
  const maxBytes = caps.maxBytes ?? RESULTS_MAX_BYTES;
  const data = emptyIndex();
  let read = 0;
  let bytes = 0;
  let overBytes = 0;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!;
    if (read >= maxFiles) {
      data.limits.push(`results: stopped after ${maxFiles} files; ${paths.length - i} not read`);
      break;
    }
    let size: number;
    try {
      size = (await stat(p)).size;
    } catch (e) {
      data.warnings.push(`${p}: ${(e as Error).message}`);
      continue;
    }
    if (bytes + size > maxBytes) {
      overBytes++;
      continue;
    }
    bytes += size;
    read++;
    await readResultsFile(p, data, caps);
  }
  if (overBytes) data.limits.push(`results: ${overBytes} file${overBytes === 1 ? '' : 's'} not read, ${overBytes === 1 ? 'it' : 'they'} would pass the ${Math.round(maxBytes / 1048576)} MB cap on results`);
  finaliseTotals(data);
  return data;
}

/** Read results text held in memory (tests and tools); the format is told from the content as for files. */
export async function readResultsString(text: string, source = 'inline'): Promise<ResultIndexData> {
  const data = emptyIndex();
  const { Readable } = await import('node:stream');
  const kind = sniffResultsFormat(text.slice(0, SNIFF_BYTES));
  if (kind === 'junit-xml') await readJunitStream(Readable.from([text]), source, data);
  else if (kind === 'tap') await readTapStream(Readable.from([text]), source, data);
  else if (kind === 'json') {
    let doc: unknown;
    try {
      doc = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (e) {
      data.warnings.push(`${source}: not valid JSON (${(e as Error).message.slice(0, 120)}); not read`);
    }
    if (doc !== undefined && !readJsonResults(doc, source, data)) data.warnings.push(`${source}: ${NOT_RESULTS}`);
  } else data.warnings.push(`${source}: ${NOT_RESULTS}`);
  finaliseTotals(data);
  return data;
}

/** JUnit XML files only; kept for callers that predate the other formats. Same as readResultsFiles. */
export const readJunitFiles = readResultsFiles;

export async function readJunitString(xml: string, source = 'inline.xml'): Promise<ResultIndexData> {
  const data = emptyIndex();
  const { Readable } = await import('node:stream');
  await readJunitStream(Readable.from([xml]), source, data);
  finaliseTotals(data);
  return data;
}
