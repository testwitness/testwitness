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

/** Collapse describe chain separators (" › ", " > ") to one space. Only a separator with whitespace on both sides counts, so "-> 90" is untouched. */
function collapseSeparators(s: string): string {
  return s.replace(/\s+(?:›|>)\s+/g, ' ');
}

/** Strip one trailing balanced bracket group `[...]` or `(...)`, or a `#n` / `{n}` index. Returns the input unchanged when nothing matches. */
function stripTrailingGroup(n: string): string {
  const m = /(?:#\d+|\{\d+\})\s*$/.exec(n);
  if (m) return n.slice(0, m.index);
  const t = n.replace(/\s+$/, '');
  const close = t[t.length - 1];
  if (close !== ']' && close !== ')') return n;
  const open = close === ']' ? '[' : '(';
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const ch = t[i];
    if (ch === close) depth++;
    else if (ch === open) {
      depth--;
      if (depth === 0) return t.slice(0, i);
    }
  }
  return n;
}

export function nameKey(name: string): string {
  let n = name.trim();
  // Strip trailing parametrisation: one or more of [..], (..), #n, {n}
  let prev: string;
  do {
    prev = n;
    n = stripTrailingGroup(n).replace(/\s+$/, '');
  } while (n !== prev && n.length > 0);
  // JUnit 5 display name with leading index "[1] 1, 2" leaves nothing useful; keep original in that case.
  if (!n) n = name.trim();
  return collapseSeparators(n).replace(/\s+/g, ' ').trim().toLowerCase();
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
  if (/\s/.test(c)) return collapseSeparators(c).replace(/\s+/g, ' ').trim().toLowerCase();
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
