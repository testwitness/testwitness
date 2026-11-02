/**
 * Name normalisation for JUnit XML producers.
 *
 * Producers disagree on everything except that a testcase has a name and
 * usually a classname. The key we build is `classKey::nameKey` where
 *   classKey = last segment of the dotted classname, lower cased, with `$`
 *              nested class separators kept (so Outer$Inner stays distinct),
 *   nameKey  = the test name lower cased, with parametrisation suffixes and
 *              trailing `()` removed and whitespace collapsed.
 *
 * Parametrisation suffixes handled:
 *   pytest      test_a[1-2]            → test_a
 *   JUnit 5     method(int)[1]         → method       (also `[1] 1, 2` display names → see displayName)
 *   JUnit 5     method()               → method
 *   TestNG      method[0](a, b)        → method
 *   Jest/Vitest each: "adds 1 + 1" rows stay as is (they are distinct tests)
 *   Playwright  "title (project)" is not a suffix we strip; the project lives in the suite name
 *   Surefire rerun "method[flaky]"      → method
 */
export function nameKey(name: string): string {
  let n = name.trim();
  // Strip trailing parametrisation: one or more of [..], (..), #n, {n}
  let prev: string;
  do {
    prev = n;
    n = n.replace(/\s*(\[[^\]]*\]|\([^()]*\)|#\d+|\{\d+\})\s*$/, '');
  } while (n !== prev && n.length > 0);
  // JUnit 5 display name with leading index "[1] 1, 2" leaves nothing useful; keep original in that case.
  if (!n) n = name.trim();
  return n.replace(/\s+/g, ' ').toLowerCase();
}

export function classKey(classname: string): string {
  let c = classname.trim();
  // Playwright and jest-junit can put a file path here; take the file stem.
  if (/[\\/]/.test(c) || /\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/.test(c)) {
    c = c.split(/[\\/]/).pop() ?? c;
    c = c.replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/, '').replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/, '');
    return c.toLowerCase();
  }
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
      // jest-junit default: classname "<describe path> <title>" and name the same; suite name is the top describe
      const full = segs.join(' ');
      out.push(`${nameKey(full)}::${nameKey(full)}`);
      // jest-junit with classname={classname} title={title}: classname = describe path, name = title
      if (describes.length) out.push(`${nameKey(describes.join(' '))}::${nameKey(title)}`);
      // Playwright: classname = file path, name = "describe › title" or title
      out.push(`${fileStem}::${nameKey(segs.join(' › '))}`);
      out.push(`${fileStem}::${nameKey(title)}`);
      // Vitest: classname = file path, name = "describe > title"
      out.push(`${fileStem}::${nameKey(segs.join(' > '))}`);
      // mocha-junit-reporter: classname = title, name = "describe path title"
      out.push(`${nameKey(title)}::${nameKey(full)}`);
      break;
    }
  }
  return [...new Set(out)];
}
