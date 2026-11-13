/**
 * Name normalisation for JUnit XML producers.
 *
 * Producers disagree on everything except that a testcase has a name and
 * usually a classname. The key we build is `classKey::nameKey` where
 *   classKey = last segment of the dotted classname, lower cased, with `$`
 *              nested class separators kept (so Outer$Inner stays distinct),
 *              or the file stem when the classname is a path,
 *   nameKey  = the test name lower cased, with parametrisation suffixes and
 *              trailing `()` removed and whitespace collapsed.
 *
 * Describe chain separators are collapsed to a single space on both sides of
 * the join, so the producer's choice of separator does not matter:
 *   jest-junit default      "Billing charge rejects"      (ancestor separator is a space)
 *   jest-junit custom       "Billing › charge"            (JEST_JUNIT_ANCESTOR_SEPARATOR=" › ")
 *   vitest                  "Cart > total > sums"
 *   playwright              "pricing › parses a dollar amount"
 *   mocha-junit-reporter    "Text slugify lowercases"
 * all reduce to space separated chains. The inventory qualifiedName uses " › ".
 *
 * Parametrisation suffixes handled:
 *   pytest      test_a[1-2]                      → test_a
 *   pytest      test_a[\xfcn\xefcode[brackets]]  → test_a   (nested brackets are balanced)
 *   JUnit 4     sizeMatchesPushes[0: pushes=1]   → sizematchespushes
 *   JUnit 5     method(int)[1]                   → method       (also `[1] 1, 2` display names → see below)
 *   JUnit 5     method()                         → method
 *   TestNG      appliesRates[0](100.0, 0.0)      → appliesrates
 *   Jest/Vitest each: "adds 1 and 2 to get 3" rows stay as is (they are distinct tests)
 *   Playwright  "title (project)" is not a suffix we strip; the project lives in the suite hostname
 *   Surefire rerun "method[flaky]"               → method
 */

/**
 * Collapse describe chain separators (" › ", " > ") to one space, and every whitespace run to one space. Only a
 * separator with whitespace on both sides counts, so "-> 90" is untouched. Whitespace runs are collapsed first: the
 * old `\s+(?:›|>)\s+` rescanned a long run of spaces from each of its positions, quadratic on a hostile test name.
 * Both callers collapsed whitespace right after, so the result is the same.
 */
function collapseSeparators(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/ (?:›|>) /g, ' ');
}

const isSpace = (ch: string): boolean => /\s/.test(ch);
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

/**
 * Start of one trailing balanced bracket group `[...]` or `(...)`, or a `#n` / `{n}` index, that ends at `end` (no
 * trailing whitespace before `end`). Undefined when there is none.
 */
function trailingGroupStart(s: string, end: number): number | undefined {
  let d = end;
  while (isDigit(s[d - 1])) d--;
  if (d < end && d > 0 && s[d - 1] === '#') return d - 1;
  if (s[end - 1] === '}') {
    d = end - 1;
    while (isDigit(s[d - 1])) d--;
    if (d < end - 1 && d > 0 && s[d - 1] === '{') return d - 1;
  }
  const close = s[end - 1];
  if (close !== ']' && close !== ')') return undefined;
  const open = close === ']' ? '[' : '(';
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === close) depth++;
    else if (ch === open) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

/**
 * Strip trailing parametrisation: one or more of [..], (..), #n, {n}, with the whitespace between them. Works on an
 * end index: the old loop rebuilt the string and rescanned it with `\s+$` once per group, quadratic on a test name of
 * many `[]` or long space runs (28 s for a 100 kB name).
 */
function stripTrailingGroups(s: string): string {
  let end = s.length;
  for (;;) {
    while (end > 0 && isSpace(s[end - 1]!)) end--;
    const cut = trailingGroupStart(s, end);
    if (cut === undefined) break;
    end = cut;
  }
  return s.slice(0, end);
}

export function nameKey(name: string): string {
  let n = stripTrailingGroups(name.trim());
  // JUnit 5 display name with leading index "[1] 1, 2" leaves nothing useful; keep original in that case.
  if (!n) n = name.trim();
  return collapseSeparators(n).trim().toLowerCase();
}

export function classKey(classname: string): string {
  let c = classname.trim();
  // Playwright, vitest and jest-junit can put a file path here; take the file stem.
  if (/[\\/]/.test(c) || /\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/.test(c)) {
    c = c.split(/[\\/]/).pop() ?? c;
    c = c.replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/, '').replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/, '');
    return c.toLowerCase();
  }
  // jest-junit with a custom ancestor separator, or mocha: a describe chain, not a dotted class.
  if (/\s/.test(c)) return collapseSeparators(c).trim().toLowerCase();
  // Dotted Java or Python path: last segment. Keep `$` for nested classes.
  const last = c.split('.').pop() ?? c;
  return last.toLowerCase();
}

export function normaliseKey(classname: string, name: string): string {
  return `${classKey(classname)}::${nameKey(name)}`;
}

/** Candidate keys for an inventory test, in match preference order. */
export function inventoryKeys(path: string, qualifiedName: string, language: 'java' | 'typescript' | 'javascript' | 'python'): string[] {
  const out: string[] = [];
  const fileStem = (path.split('/').pop() ?? path).replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/, '').replace(/\.[^.]+$/, '').toLowerCase();
  switch (language) {
    case 'java': {
      const [cls, method] = qualifiedName.split('#');
      if (cls && method) {
        out.push(`${cls.toLowerCase()}::${nameKey(method)}`);
        // Surefire writes nested classes as Outer$Inner; Gradle sometimes writes Outer.Inner
        if (cls.includes('$')) out.push(`${cls.split('$').pop()!.toLowerCase()}::${nameKey(method)}`);
      }
      out.push(`${fileStem}::${nameKey(qualifiedName)}`);
      break;
    }
    case 'python': {
      const parts = qualifiedName.split('::');
      const method = parts[parts.length - 1]!;
      if (parts.length > 1) out.push(`${parts[parts.length - 2]!.toLowerCase()}::${nameKey(method)}`);
      out.push(`${fileStem}::${nameKey(method)}`);
      break;
    }
    case 'typescript':
    case 'javascript': {
      const segs = qualifiedName.split(' › ');
      const title = segs[segs.length - 1]!;
      const describes = segs.slice(0, -1);
      const full = nameKey(segs.join(' '));
      // jest-junit default: classname "<describe path> <title>" and name the same
      out.push(`${full}::${full}`);
      // jest-junit with classname={classname} title={title}: classname = describe path (any separator), name = title
      if (describes.length) out.push(`${nameKey(describes.join(' '))}::${nameKey(title)}`);
      // Playwright and vitest: classname = file path, name = describe chain plus title (separator collapsed)
      out.push(`${fileStem}::${full}`);
      // Playwright without describe, or jest-junit with classname={filename}: classname = file, name = title
      out.push(`${fileStem}::${nameKey(title)}`);
      // mocha-junit-reporter: classname = bare title, name = full chain joined by spaces
      out.push(`${nameKey(title)}::${full}`);
      break;
    }
  }
  return [...new Set(out)];
}
