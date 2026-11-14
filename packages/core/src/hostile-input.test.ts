// Regression tests for the ReDoS scan (scripts/security/redos-scan.mjs, docs/threat-model.md "ReDoS") and for config
// files nested deep enough to crash a parser. Each regular expression that was quadratic (or worse) on text a pull
// request controls was replaced; these tests pin two things for each: the replacement reads the same language, and
// 100 kB of the input that used to take seconds is read well inside the limit.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConfigError, parseConfig } from './config.js';
import { CONFIG_MAX_NESTING, nestsTooDeep, parseXml, parseYamlOrJson } from './config-text.js';
import { looksLikeTestSource } from './diff/classify.js';
import { findClaims, stripChecklist, stripNonProse } from './evidence/claims.js';
import { regexLines, replaceDelimited, trimEndChars } from './linear.js';
import { isGeneratedPattern, selectorsOf, thresholdsOf } from './rules/C.js';
import { claimsRegression } from './rules/O.js';
import { definedSymbols, testTokens } from './rules/util.js';
import { templateTitle } from './rules/V.js';
import { INLINE_SUPPRESSORS, stripYamlAndJson, usesTestwitness } from './rules/W.js';
import { normaliseText } from './treesitter.js';

const N = 100_000;
const LIMIT_MS = 2000;

function fast<T>(name: string, run: () => T): T {
  const t0 = performance.now();
  const out = run();
  expect(performance.now() - t0, `${name} took too long`).toBeLessThan(LIMIT_MS);
  return out;
}

/** Text made of the tokens a pattern is about, so random strings reach its branches. */
const made = (tokens: string[], max = 12): fc.Arbitrary<string> => fc.array(fc.constantFrom(...tokens), { maxLength: max }).map((t) => t.join(''));
const RUNS = { numRuns: 3000, seed: 20261113 };

describe('linear replacements read the same language as the regular expressions they replaced', () => {
  it('trimEndChars', () => {
    fc.assert(fc.property(made(['/', 'a', ')', '*', '$', ' ', '!', ']', '\n']), (s) => {
      expect(trimEndChars(s, '/')).toBe(s.replace(/\/+$/, ''));
      expect(trimEndChars(s, '*?$)|[]{}+!')).toBe(s.replace(/[*?$)|[\]{}+!]+$/, ''));
    }), RUNS);
  });

  it('replaceDelimited', () => {
    fc.assert(fc.property(made(['/*', '*/', '/', '*', 'a', '\n', '<!--', '-->', '-', '```', '`', ' ']), (s) => {
      expect(replaceDelimited(s, '/*', '*/', '')).toBe(s.replace(/\/\*[\s\S]*?\*\//g, ''));
      expect(replaceDelimited(s, '<!--', '-->', ' ')).toBe(s.replace(/<!--[\s\S]*?-->/g, ' '));
      expect(replaceDelimited(s, '```', '```', ' ')).toBe(s.replace(/```[\s\S]*?```/g, ' '));
    }), RUNS);
  });

  it('claimsRegression', () => {
    const old = /\bregression\b|\bfix(es|ed)?\b.*\btests?\b/i;
    fc.assert(fc.property(made(['fix', 'fixes', 'Fixed', 'test', 'tests', 'regression', ' ', '\n', '\r', '\u2028', 'x', '-', 'the ', 'prefix', 'contest']), (s) => {
      expect(claimsRegression(s)).toBe(old.test(s));
    }), RUNS);
  });

  it('the describe and it sniff, and the def sniff', () => {
    // A member call (`schema.describe(`, `pattern.test(`) is not a declaration; `test.describe(` is.
    const oldDescribe = /(?<![.\w$])(test\.)?(describe|context|suite)\s*(\.\w+)?\s*\(/;
    const oldIt = /(?<![.\w$])(it|test|specify)\s*(\.\w+)?\s*\(/;
    const oldDef = /^\s*(async\s+)?def\s+test_?\w*\s*\(/m;
    fc.assert(fc.property(made(['describe', 'it', 'test', '.only', '.', ' ', '\n', '\t', '(', 'x', 'async ', 'def ', 'test_a', '\r', '#']), (s) => {
      expect(looksLikeTestSource('typescript', s)).toBe(s !== '' && oldDescribe.test(s) && oldIt.test(s));
      expect(looksLikeTestSource('python', s)).toBe(s !== '' && (oldDef.test(s) || /\bunittest\.TestCase\b/.test(s)));
    }), RUNS);
  });

  it('the key in front of a workflow or package.json command', () => {
    const old = (line: string): string => line.replace(/^\s*-?\s*(run|script|cmd|command|"test"|test|"[\w:-]+")\s*:\s*/, '').replace(/^\s*"[^"]*"\s*:\s*"/, '').replace(/",?\s*$/, '').replace(/\\"/g, '"');
    fc.assert(fc.property(made(['-', ' ', '\t', 'run', 'test', '"test"', '"a:b"', ':', 'npm test', '"', ',', '\\"', 'x']), (s) => {
      expect(stripYamlAndJson(s)).toBe(old(s));
    }), RUNS);
  });

  it('the Gradle exclude patterns', () => {
    const olds: Array<[RegExp, RegExp]> = [
      [/\bexclude\s*\(?\s*((?:["'][^"'\n]+["']\s*,?\s*)+)/g, /\bexclude\s*(?:\(\s*)?((?:["'][^"'\n]+["']\s*(?:,\s*)?)+)/g],
      [/\bexcludeTestsMatching\s*\(?\s*((?:["'][^"'\n]+["']\s*,?\s*)+)/g, /\bexcludeTestsMatching\s*(?:\(\s*)?((?:["'][^"'\n]+["']\s*(?:,\s*)?)+)/g],
      [
        /\b(excludeTags|excludeCategories|excludeGroups|excludeEngines)\s*(?:\(|\+=|\.add(?:All)?\()?\s*((?:(?:setOf\(|listOf\()?["'][^"'\n]+["']\s*,?\s*\)?\s*)+)/g,
        /\b(excludeTags|excludeCategories|excludeGroups|excludeEngines)\s*(?:(?:\(|\+=|\.add(?:All)?\()\s*)?((?:(?:setOf\(|listOf\()?["'][^"'\n]+["']\s*(?:,\s*)?(?:\)\s*)?)+)/g,
      ],
    ];
    fc.assert(fc.property(made(['exclude', 'excludeTestsMatching', 'excludeTags', ' ', '(', ')', ',', '"a"', "'b'", '"', '\n', '+=', '.add(', '.addAll(', 'setOf(', 'listOf(', 'x'], 14), (s) => {
      for (const [before, after] of olds) expect([...s.matchAll(after)].map((m) => [...m])).toEqual([...s.matchAll(before)].map((m) => [...m]));
    }), RUNS);
  });

  it('regexLines splits where `.` stops', () => {
    expect(regexLines('a\nb\rc\u2028d\u2029e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('100 kB of the input each pattern was slow on', () => {
  it('diff classification sniffs', () => {
    fast('describe + spaces', () => looksLikeTestSource('typescript', `describe${' '.repeat(N)}`));
    fast('it + spaces', () => looksLikeTestSource('javascript', `describe(it${' '.repeat(N)}`));
    fast('python blank lines', () => looksLikeTestSource('python', '\n'.repeat(N)));
    // U+2028 is whitespace and a line start for `^`: indentation must not include it.
    fast('python line separators', () => looksLikeTestSource('python', '\u2028'.repeat(N)));
    fast('checklist line separators', () => stripChecklist(stripNonProse('\u2028'.repeat(N))));
  });

  it('PR text: checklists, comments, fences and the regression claim', () => {
    fast('blank lines', () => stripNonProse('\n'.repeat(N)));
    fast('spaces', () => stripChecklist(' '.repeat(N)));
    fast('blank lines, checklist', () => stripChecklist('\n'.repeat(N)));
    fast('comment openers', () => stripNonProse('<!--'.repeat(N / 4)));
    fast('fence openers', () => stripNonProse('``` a '.repeat(N / 6)));
    fast('claims', () => findClaims(`${'<!-- '.repeat(N / 5)}\n${'\n'.repeat(N)}All tests pass`));
    expect(fast('fix fix fix', () => claimsRegression('fix '.repeat(N / 4)))).toBe(false);
  });

  it('still strips what it stripped', () => {
    expect(stripNonProse('a\n- [ ] run tests\nb')).toBe('a\n \nb');
    expect(stripNonProse('a <!-- all tests pass --> b ```all tests pass``` c `x`')).toBe('a   b   c  ');
    expect(stripChecklist('  - [x] Added tests\n1. [ ] no\ntext [x] stays')).toBe(' \n \ntext [x] stays');
    expect(findClaims('- [ ] all tests pass\n<!-- all tests pass -->')).toEqual([]);
    expect(findClaims('All tests pass').map((c) => c.kind)).toEqual(['tests-pass']);
  });

  it('Java sources and symbols', () => {
    fast('public public public', () => definedSymbols('public '.repeat(N / 7), 'java'));
    expect([...definedSymbols('public static <T> Map<String, List<T>> groupByName(List<T> in) {', 'java')]).toEqual(['groupByName']);
    fast('comment openers, normalise', () => normaliseText('/* '.repeat(N / 3)));
    expect(normaliseText('a /* b */ c // d\n e')).toBe('a c e');
  });

  it('runner config readers', () => {
    fast('gradle exclude + spaces', () => selectorsOf('build.gradle', `test {\n  exclude${' '.repeat(N)}\n}\n`));
    fast('gradle excludeTags + spaces', () => selectorsOf('build.gradle.kts', `tasks.test {\n  excludeTags${' '.repeat(N)}\n  excludeTestsMatching${' '.repeat(N)}\n}\n`));
    expect(selectorsOf('build.gradle', "test {\n  exclude '**/SlowTest*', \"**/It*\"\n  excludeTags 'slow'\n}\n").map((s) => s.pattern).sort()).toEqual(['**/It*', '**/SlowTest*', 'slow']);
    fast('gradle minimum = + spaces', () => thresholdsOf('build.gradle', `jacocoTestCoverageVerification {\n  violationRules {\n    rule {\n      limit {\n        minimum =${' '.repeat(N)}x\n      }\n    }\n  }\n}\n`));
    expect(thresholdsOf('build.gradle', 'jacocoTestCoverageVerification {\n  violationRules {\n    rule {\n      limit {\n        minimum = new BigDecimal( "0.80")\n      }\n    }\n  }\n}\n').map((t) => t.value)).toEqual(thresholdsOf('build.gradle', 'jacocoTestCoverageVerification {\n  violationRules {\n    rule {\n      limit {\n        minimum = 0.80\n      }\n    }\n  }\n}\n').map((t) => t.value));
    fast('trailing glob characters', () => isGeneratedPattern(`${')'.repeat(N)} x`));
    fast('trailing slashes', () => selectorsOf('jest.config.js', `module.exports = { testPathIgnorePatterns: ['${'/'.repeat(N)}!'] }`));
    fast('command key + spaces', () => stripYamlAndJson(' '.repeat(N)));
  });
});

describe('more replacements, checked the same way', () => {
  it('the test tokenizer gives the tokens of the regular expressions it replaced', () => {
    const oldTokens = (src: string, python: boolean, name: string): string[] => {
      const re = python
        ? /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#[^\n]*)|([A-Za-z_$][\w$]*|\d[\w.]*)|(\S)/g
        : /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_$][\w$]*|\d[\w.]*)|(\S)/g;
      const out: string[] = [];
      for (const m of src.matchAll(re)) {
        if (m[2] !== undefined) continue;
        if (m[1] !== undefined) {
          const q = m[1].startsWith('"""') || m[1].startsWith("'''") ? 3 : 1;
          const content = m[1].slice(q, -q);
          if (content === name) continue;
          out.push(`"${content}`);
          continue;
        }
        const tok = m[3] ?? m[4]!;
        if (tok === ';' || tok === name) continue;
        out.push(tok);
      }
      return out;
    };
    const source = made(['"', "'", '`', '"""', "'''", '\\', '\\"', "\\'", '\n', '\r', '\u2028', ' ', 'a', 'b1', '9.5', ';', '#', '//', '/*', '*/', '/', '*', '(', '${x}', 'name', '\t'], 16);
    fc.assert(fc.property(source, fc.boolean(), (s, python) => {
      expect(testTokens(s, python ? 'python' : 'typescript', 'name')).toEqual(oldTokens(s, python, 'name'));
    }), { numRuns: 20_000, seed: 20261113 });
  });

  it('the tokenizer reads 100 kB of unterminated strings and comments in linear time', () => {
    for (const unit of ['"\\', "'\\", '`\\', '"""', "'''", '/* ', '" ', '`', '"\\"']) {
      const src = unit.repeat(Math.ceil(N / unit.length));
      fast(`js ${JSON.stringify(unit)}`, () => testTokens(src, 'typescript', 'x'));
      fast(`python ${JSON.stringify(unit)}`, () => testTokens(src, 'python', 'x'));
    }
    expect(testTokens('expect(add(1, 2)).toBe("3"); // sum', 'typescript', 'x')).toEqual(['expect', '(', 'add', '(', '1', ',', '2', ')', ')', '.', 'toBe', '(', '"3', ')']);
  });

  it('Java method names', () => {
    const old = /\b(?:public|protected)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+)*(?:<[^>]*>\s*)?[\w.<>[\],?\s]{1,300}?\s+(\w+)\s*\(/g;
    fc.assert(fc.property(made(['public', 'protected', ' ', '\n', 'static ', 'final ', '<T>', 'Map<String, List<T>>', 'void', 'int[]', 'name', 'other', '(', ')', ',', '.', '?', '\t'], 14), (s) => {
      const expected = new Set<string>();
      for (const m of s.matchAll(old)) if (m[1] && m[1].length >= 4) expected.add(m[1]);
      for (const m of s.matchAll(/\b(?:class|interface|enum|record)\s+(\w+)/g)) if (m[1] && m[1].length >= 4) expected.add(m[1]);
      expect(definedSymbols(s, 'java')).toEqual(expected);
    }), RUNS);
    fast('public + spaces', () => definedSymbols(`public${' '.repeat(N)}`, 'java'));
    fast('public x + spaces', () => definedSymbols(`public x${' '.repeat(N)}y`, 'java'));
  });

  it('the exit code switch', () => {
    const old = /--exitcode\s*[= ]\s*0\b|--exit-code\s*[= ]\s*0\b/;
    const now = INLINE_SUPPRESSORS.find((s) => s.what === '--exitcode 0')!.re;
    fc.assert(fc.property(made(['--exitcode', '--exit-code', '--exit--code', ' ', '\t', '=', '0', '1', '00', 'x', '\n']), (s) => {
      expect(now.test(s)).toBe(old.test(s));
    }), RUNS);
    fast('spaces', () => now.test(`--exitcode${' '.repeat(N)}`));
    fast('tabs', () => now.test(`--exit-code${'\t'.repeat(N)}1`));
  });

  it('a workflow that uses testwitness', () => {
    const old = /uses:\s*\S*testwitness/i;
    fc.assert(fc.property(made(['uses:', 'USES:', ' ', '\n', 'testwitness', 'TestWitness', 'org/', '@v1', 'x', '-', 'uses', ':', '\t'], 10), (s) => {
      expect(usesTestwitness(s)).toBe(old.test(s));
    }), RUNS);
    expect(fast('uses:uses:uses:', () => usesTestwitness('uses:'.repeat(N / 5)))).toBe(false);
    expect(usesTestwitness('    - uses: testwitness/testwitness@v1')).toBe(true);
    expect(usesTestwitness('    - uses:\n        ./\n      with:\n        mode: testwitness')).toBe(false);
  });

  it('template titles', () => {
    const old = (q: string): string => (q.includes('`') ? q.replace(/`([^`]*)`/g, (whole, inner: string) => (inner.includes('${') ? inner.replace(/\$\{[^}]*\}/g, '%s') : whole)) : q);
    fc.assert(fc.property(made(['`', '${', '}', 'a', ' ', '$', '{', 'case ']), (s) => {
      expect(templateTitle(s)).toBe(old(s));
    }), RUNS);
    fast('${ without }', () => templateTitle(`\`${'${'.repeat(N / 2)}\``));
  });
});

describe('config files nested deeper than the readers accept', () => {
  it('counts nesting without parsing', () => {
    expect(nestsTooDeep('a:\n  b: [1, {c: [2]}]\n', 'yaml-json')).toBe(false);
    expect(nestsTooDeep('['.repeat(CONFIG_MAX_NESTING), 'yaml-json')).toBe(false);
    expect(nestsTooDeep('['.repeat(CONFIG_MAX_NESTING + 1), 'yaml-json')).toBe(true);
    expect(nestsTooDeep('{"a":'.repeat(CONFIG_MAX_NESTING + 1), 'yaml-json')).toBe(true);
    expect(nestsTooDeep(`${'- '.repeat(CONFIG_MAX_NESTING + 1)}x`, 'yaml-json')).toBe(true);
    expect(nestsTooDeep(Array.from({ length: 2 * CONFIG_MAX_NESTING + 2 }, (_, i) => `${' '.repeat(i)}a:`).join('\n'), 'yaml-json')).toBe(true);
    // Balanced brackets and long lists are not nesting.
    expect(nestsTooDeep('[]'.repeat(5000), 'yaml-json')).toBe(false);
    expect(nestsTooDeep(Array.from({ length: 5000 }, (_, i) => `- item${i}`).join('\n'), 'yaml-json')).toBe(false);
    expect(nestsTooDeep(`${'<a>'.repeat(CONFIG_MAX_NESTING + 1)}`, 'xml')).toBe(true);
    expect(nestsTooDeep(`<p>${'<a/><b></b><!-- <c> --><?x?>'.repeat(5000)}</p>`, 'xml')).toBe(false);
    expect(nestsTooDeep('['.repeat(5000), 'xml')).toBe(false);
  });

  it('the readers refuse such a file instead of recursing into it', () => {
    // 200,000 open brackets in a YAML file aborted the process inside the parser; no try can catch that.
    for (const n of [1000, 200_000]) {
      expect(fast('yaml brackets', () => parseYamlOrJson('['.repeat(n)))).toBeUndefined();
      expect(fast('yaml dashes', () => parseYamlOrJson(`${'- '.repeat(n)}x`))).toBeUndefined();
      expect(fast('xml', () => parseXml('<a>'.repeat(n) + '</a>'.repeat(n)))).toBeUndefined();
    }
    expect(parseYamlOrJson('{"a": [1, 2]}')).toEqual({ a: [1, 2] });
    expect(parseXml('<a><b>t</b></a>')?.children[0]?.name).toBe('a');
  });

  it('a changed runner config nested too deep is reported, not skipped', () => {
    expect(selectorsOf('.mocharc.yml', '['.repeat(1000))).toEqual([]);
    expect(thresholdsOf('codecov.yml', '['.repeat(1000))).toEqual([]);
    expect(selectorsOf('pom.xml', `<project>${'<a>'.repeat(1000)}</project>`)).toEqual([]);
  });

  it('.testwitness.yml nested too deep is a ConfigError', () => {
    expect(() => parseConfig(`rules: ${'['.repeat(1000)}`)).toThrow(ConfigError);
    expect(() => parseConfig(`rules: ${'['.repeat(1000)}`)).toThrow(/nested deeper than 200 levels/);
  });
});
