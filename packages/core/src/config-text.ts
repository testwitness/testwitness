/**
 * Readers for runner and coverage configuration, as text. Nothing here imports, requires or executes a config
 * file: JavaScript and TypeScript configs are read by a lenient literal parser that understands object and array
 * literals, strings, numbers, booleans and regular expression literals, and treats every other expression as opaque.
 * YAML, JSON, TOML, INI, XML and properties files go through real parsers. Every reader returns undefined (or an
 * empty result) on input it cannot read, never throws.
 */
import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';

/** A value read from a JavaScript literal. Regex literals and unreadable expressions are tagged objects. */
export type Lit = string | number | boolean | null | Lit[] | LitObject | LitRegex | LitOpaque;
export interface LitObject {
  [k: string]: Lit;
}
export interface LitRegex {
  $regex: string;
}
export interface LitOpaque {
  $opaque: string;
}

export function isRegexLit(v: unknown): v is LitRegex {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as LitRegex).$regex === 'string';
}
export function isOpaqueLit(v: unknown): v is LitOpaque {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as LitOpaque).$opaque === 'string';
}
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !isRegexLit(v) && !isOpaqueLit(v);
}

/** Replace comments with spaces, keeping offsets and strings intact. */
export function stripJsComments(text: string): string {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    // A backslash outside a string only occurs in a regular expression literal: skip the escaped character, so `/a\//` is not a comment.
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < text.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
      }
      i += 2;
      continue;
    }
    i++;
  }
  return out.join('');
}

class LiteralParser {
  pos: number;
  constructor(
    readonly s: string,
    start: number,
  ) {
    this.pos = start;
  }

  ws(): void {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos]!)) this.pos++;
  }

  value(depth = 0): Lit {
    if (depth > 64) throw new Error('too deep');
    this.ws();
    const c = this.s[this.pos];
    if (c === undefined) throw new Error('end of input');
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"' || c === "'" || c === '`') return this.string();
    if (c === '/') return this.regex();
    const num = /^-?(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:e[+-]?\d+)?(?![\w$])/i.exec(this.s.slice(this.pos, this.pos + 40));
    if (num) {
      this.pos += num[0].length;
      return Number(num[0].replace(/_/g, ''));
    }
    const word = /^(true|false|null|undefined)(?![\w$])/.exec(this.s.slice(this.pos, this.pos + 10));
    if (word) {
      this.pos += word[0].length;
      return word[1] === 'true' ? true : word[1] === 'false' ? false : null;
    }
    return { $opaque: this.opaque() };
  }

  /** Skip an expression up to a comma or closing bracket at depth 0. */
  opaque(): string {
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.s.length) {
      const c = this.s[this.pos]!;
      if (c === '"' || c === "'" || c === '`') {
        this.string();
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if ((c === ',' || c === ';') && depth === 0) break;
      this.pos++;
    }
    return this.s.slice(start, this.pos).trim();
  }

  string(): string | LitOpaque {
    const q = this.s[this.pos]!;
    this.pos++;
    let out = '';
    let templated = false;
    while (this.pos < this.s.length && this.s[this.pos] !== q) {
      const c = this.s[this.pos]!;
      if (c === '\\') {
        const n = this.s[this.pos + 1] ?? '';
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        this.pos += 2;
        continue;
      }
      if (q === '`' && c === '$' && this.s[this.pos + 1] === '{') templated = true;
      out += c;
      this.pos++;
    }
    this.pos++;
    return templated ? { $opaque: out } : out;
  }

  regex(): LitRegex {
    this.pos++;
    let out = '';
    let inClass = false;
    while (this.pos < this.s.length) {
      const c = this.s[this.pos]!;
      if (c === '\\') {
        out += c + (this.s[this.pos + 1] ?? '');
        this.pos += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      else if (c === '\n') throw new Error('unterminated regex');
      out += c;
      this.pos++;
    }
    this.pos++;
    while (/[a-z]/.test(this.s[this.pos] ?? '')) this.pos++;
    return { $regex: out };
  }

  key(): string | undefined {
    this.ws();
    const c = this.s[this.pos];
    if (c === '"' || c === "'") {
      const k = this.string();
      return typeof k === 'string' ? k : undefined;
    }
    if (c === '[') {
      this.pos++;
      this.opaque();
      this.pos++;
      return undefined;
    }
    const m = /^[\w$]+/.exec(this.s.slice(this.pos, this.pos + 200));
    if (!m) throw new Error(`unexpected ${c}`);
    this.pos += m[0].length;
    return m[0];
  }

  object(depth: number): LitObject {
    this.pos++;
    const out: LitObject = {};
    for (;;) {
      this.ws();
      if (this.s[this.pos] === '}') {
        this.pos++;
        return out;
      }
      if (this.pos >= this.s.length) throw new Error('unterminated object');
      if (this.s.startsWith('...', this.pos)) {
        this.pos += 3;
        this.value(depth + 1);
      } else {
        // get/set/async prefixes of methods
        const save = this.pos;
        const k = this.key();
        this.ws();
        const n = this.s[this.pos];
        if (n === ':') {
          this.pos++;
          const v = this.value(depth + 1);
          if (k !== undefined) out[k] = v;
        } else if (n === '(' || /[\w$]/.test(n ?? '')) {
          // method shorthand: skip parameters and body
          this.pos = save;
          this.opaque();
        } else if (k !== undefined) {
          out[k] = { $opaque: k };
        }
      }
      this.ws();
      if (this.s[this.pos] === ',') this.pos++;
      else if (this.s[this.pos] !== '}') throw new Error(`expected , or } at ${this.pos}`);
    }
  }

  array(depth: number): Lit[] {
    this.pos++;
    const out: Lit[] = [];
    for (;;) {
      this.ws();
      if (this.s[this.pos] === ']') {
        this.pos++;
        return out;
      }
      if (this.pos >= this.s.length) throw new Error('unterminated array');
      if (this.s.startsWith('...', this.pos)) {
        this.pos += 3;
        out.push({ $opaque: `...${this.opaque()}` });
      } else out.push(this.value(depth + 1));
      this.ws();
      if (this.s[this.pos] === ',') this.pos++;
      else if (this.s[this.pos] !== ']') throw new Error(`expected , or ] at ${this.pos}`);
    }
  }
}

/** Parse the literal that starts at `start` (after comments were stripped). */
export function parseLiteralAt(text: string, start: number): Lit | undefined {
  try {
    return new LiteralParser(text, start).value();
  } catch {
    return undefined;
  }
}

/** Occurrences of one key read at most from a JavaScript or TypeScript config. */
export const JS_KEY_MAX_OCCURRENCES = 64;

/**
 * Every value written for `key` in a JavaScript or TypeScript config, as literals, in source order. A key that
 * appears in several places (projects, overrides) yields several values.
 */
export function jsValuesForKey(text: string, key: string): Lit[] {
  const s = stripJsComments(text);
  const re = new RegExp(`(?:^|[\\s{,(])(?:${key}|'${key}'|"${key}")\\s*:\\s*`, 'g');
  const out: Lit[] = [];
  // Each value parse can scan to the end of the text, so a file that repeats the key thousands of times was quadratic.
  // Real configs write a key a handful of times (projects, overrides); later occurrences are not read.
  let seen = 0;
  for (let m = re.exec(s); m && seen < JS_KEY_MAX_OCCURRENCES; m = re.exec(s), seen++) {
    const v = parseLiteralAt(s, m.index + m[0].length);
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** JSON, JSONC or YAML text to a value. */
export function parseYamlOrJson(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    try {
      return parseYaml(stripJsComments(text));
    } catch {
      return undefined;
    }
  }
}

export function parseTomlSafe(text: string): Record<string, unknown> | undefined {
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** INI as Python's configparser reads it: sections, `key = value` or `key: value`, indented continuation lines. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | undefined;
  let lastKey: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    // Comments and blank lines; configparser allows blank lines inside a multi line value.
    if (/^\s*[#;]/.test(raw) || !raw.trim()) continue;
    const sec = /^\[([^\]]+)\]\s*$/.exec(raw.trim());
    if (sec && !/^\s/.test(raw)) {
      section = out[sec[1]!.trim()] ??= {};
      lastKey = undefined;
      continue;
    }
    if (/^\s/.test(raw) && section && lastKey !== undefined) {
      section[lastKey] = `${section[lastKey]}\n${raw.trim()}`;
      continue;
    }
    // Split at the first `=` or `:` by index, not with a regex: `[^=:]+?\s*[=:]` backtracks quadratically on a long
    // line of spaces, so a hostile setup.cfg could stall the check.
    const sep = raw.search(/[=:]/);
    if (sep > 0 && section) {
      lastKey = raw.slice(0, sep).trim().toLowerCase().replace(/-/g, '_');
      const value = raw.slice(sep + 1);
      const comment = value.search(/\s[#;]/);
      section[lastKey] = (comment >= 0 ? value.slice(0, comment) : value).trim();
    }
  }
  return out;
}

/** Java properties: `key=value` or `key: value` lines. */
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith('!')) continue;
    const m = /^([^=:\s]+)\s*[=:\s]\s*(.*)$/.exec(l);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
  parent?: XmlNode;
}

/** Small DOM from saxes. Entities are not expanded beyond the XML built ins, DTDs are never fetched. */
export function parseXml(text: string): XmlNode | undefined {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const parser = new SaxesParser({ xmlns: false, position: false });
  let failed = false;
  parser.on('error', () => {
    failed = true;
  });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    const parent = stack[stack.length - 1]!;
    const node: XmlNode = { name: tag.name.replace(/^.*:/, ''), attrs: { ...tag.attributes } as Record<string, string>, children: [], text: '', parent };
    parent.children.push(node);
    stack.push(node);
  });
  parser.on('text', (t: string) => {
    stack[stack.length - 1]!.text += t;
  });
  parser.on('cdata', (t: string) => {
    stack[stack.length - 1]!.text += t;
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  try {
    parser.write(text).close();
  } catch {
    failed = true;
  }
  if (failed && !root.children.length) return undefined;
  return root;
}

export function xmlAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    xmlAll(c, name, out);
  }
  return out;
}

export function xmlChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

export function xmlText(node: XmlNode | undefined): string | undefined {
  return node ? node.text.trim() : undefined;
}

/** Split a command line into words, honouring single and double quotes. */
export function shellWords(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

/** 1 based line of the first line containing every needle, or undefined. */
export function lineOf(text: string | undefined, ...needles: string[]): number | undefined {
  if (!text) return undefined;
  const want = needles.filter(Boolean);
  if (!want.length) return undefined;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (want.every((n) => lines[i]!.includes(n))) return i + 1;
  if (want.length > 1) return lineOf(text, want[0]!);
  return undefined;
}

export function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Balanced `{ ... }` bodies of blocks whose header matches `header` (the header must end at the opening brace). */
export function blockBodies(text: string, header: RegExp): Array<{ body: string; offset: number }> {
  const s = stripJsComments(text);
  const out: Array<{ body: string; offset: number }> = [];
  const re = new RegExp(header.source, header.flags.includes('g') ? header.flags : header.flags + 'g');
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const open = m.index + m[0].length - 1;
    if (s[open] !== '{') continue;
    let depth = 0;
    let i = open;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < s.length && s[i] !== q && s[i] !== '\n') {
          if (s[i] === '\\') i++;
          i++;
        }
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ body: s.slice(open + 1, i), offset: open + 1 });
    // A block that never closes runs to the end of the text, and so would every later header inside it: stop here, so
    // a file of unclosed headers costs one scan instead of one per header (it was quadratic).
    if (i >= s.length) break;
  }
  return out;
}
