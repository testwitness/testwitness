// ReDoS scan: every regular expression literal (and every `new RegExp` with a literal pattern) in the shipped source
// is run against adversarial inputs of 100 kB under a time limit. Run: node scripts/security/redos-scan.mjs [--json out]
// A regex is reported when one input takes longer than SLOW_MS, or is cut off at LIMIT_MS. This is a search, not a
// proof: the inputs are repeated runs built from generic characters and from the literal words of each regex.
import ts from 'typescript';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SIZE = 100_000;
const SLOW_MS = Number(process.env.REDOS_SLOW_MS ?? 250);
const LIMIT_MS = Number(process.env.REDOS_LIMIT_MS ?? 2000);
const files = execFileSync('git', ['ls-files', 'packages'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /^packages\/[^/]+\/src\//.test(f) && f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('/testing/') && !f.endsWith('test-util.ts') && !f.endsWith('testkit.ts'));

const found = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const visit = (n) => {
    const line = () => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    if (ts.isRegularExpressionLiteral(n)) {
      const text = n.getText();
      const end = text.lastIndexOf('/');
      found.push({ file, line: line(), source: text.slice(1, end), flags: text.slice(end + 1) });
    } else if (ts.isNewExpression(n) && n.expression.getText() === 'RegExp') {
      const a = n.arguments?.[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) found.push({ file, line: line(), source: a.text, flags: n.arguments[1] && ts.isStringLiteral(n.arguments[1]) ? n.arguments[1].text : '' });
      else found.push({ file, line: line(), dynamic: n.getText().slice(0, 160) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const UNITS = [' ', 'a', '0', '\t', 'a ', ' a', '-', '.', '/', '"', "'", '\\', '=', '_', 'a.', 'a,', '::', '#', '<', '>', '(', ')', '[', ']', ',', ':', '*', '!', '@', '\n', ' \n', 'a\n', 'x=', '- ', "' ", '" ', 'a-', 'A', '$', '{', '}', '`', ';', '&', '|', '%', '\r', 'a/', '../', '\\\\', 'a b', '1.', '0,', ' -c x', ' --a', '-C ', 'é', '\u2028'];
const SUFFIXES = ['', '!', 'a\u2028b', '\n!', '"'];

/** Literal words of a regex, used as prefixes and as repeat units. */
function words(source) {
  const out = new Set();
  for (const m of source.replace(/\\[dDwWsSbB]/g, ' ').replace(/\\(.)/g, '$1').matchAll(/[A-Za-z][A-Za-z !:.-]{1,20}/g)) out.add(m[0]);
  // Literal runs with punctuation too: the opener of `<!--[\s\S]*?-->` repeated is what makes it quadratic.
  for (const m of source.matchAll(/(?:\\[^dDwWsSbBnrtvfuxpPk0-9]|[^\\()[\]{}|*+?^$.])+/g)) {
    const lit = m[0].replace(/\\(.)/g, '$1');
    if (lit.length >= 2 && lit.length <= 24) out.add(lit);
  }
  return [...out].slice(0, 12);
}

const ctx = vm.createContext({ re: null, s: '' });
const TEST = new vm.Script('re.test(s)');
const REPLACE = new vm.Script('s.replace(re, "")');

function time(re, input) {
  ctx.re = re;
  ctx.s = input;
  const t0 = performance.now();
  try {
    (re.global || re.sticky ? REPLACE : TEST).runInContext(ctx, { timeout: LIMIT_MS });
  } catch (e) {
    if (/timed out/i.test(String(e))) return Infinity;
    throw e;
  }
  return performance.now() - t0;
}

const bodies = new Map();
const bodyOf = (u) => bodies.get(u) ?? bodies.set(u, u.repeat(Math.ceil(SIZE / u.length)).slice(0, SIZE)).get(u);

const results = [];
let inputsRun = 0;
for (const r of found) {
  if (r.dynamic) {
    results.push({ ...r, verdict: 'dynamic' });
    continue;
  }
  let re;
  try {
    re = new RegExp(r.source, r.flags);
  } catch {
    results.push({ ...r, verdict: 'invalid' });
    continue;
  }
  const w = words(r.source);
  const prefixes = ['', ...w.slice(0, 4), ...w.slice(0, 2).map((x) => x + ' ')];
  const units = [...UNITS, ...w, ...w.map((x) => x + ' ')];
  let worst = { ms: 0 };
  outer: for (const p of prefixes) {
    for (const u of units) {
      const body = bodyOf(u);
      for (const sfx of SUFFIXES) {
        const input = p + body + sfx;
        const ms = time(re, input);
        inputsRun++;
        if (ms > worst.ms) worst = { ms, prefix: p, unit: u, suffix: sfx };
        // One input over the limit, or several times over the slow mark, settles it; trying the rest only costs time.
        if (ms === Infinity || ms > SLOW_MS * 4) break outer;
      }
    }
  }
  results.push({ ...r, verdict: worst.ms === Infinity ? 'timeout' : worst.ms > SLOW_MS ? 'slow' : 'ok', worst });
  if (results.length % 50 === 0) process.stderr.write(`${results.length} of ${found.length}\n`);
}

const bad = results.filter((r) => r.verdict === 'timeout' || r.verdict === 'slow');
const dyn = results.filter((r) => r.verdict === 'dynamic');
console.log(`${found.length} regular expressions in ${files.length} files; ${inputsRun} inputs of ${SIZE} characters run.`);
console.log(`${bad.length} slow or cut off (over ${SLOW_MS} ms, limit ${LIMIT_MS} ms); ${dyn.length} built at run time (listed for hand review).`);
for (const r of bad) console.log(`${r.verdict.toUpperCase()} ${r.file}:${r.line} /${r.source}/${r.flags}  worst ${r.worst.ms === Infinity ? '>limit' : Math.round(r.worst.ms) + ' ms'} with prefix ${JSON.stringify(r.worst.prefix)} unit ${JSON.stringify(r.worst.unit)} suffix ${JSON.stringify(r.worst.suffix)}`);
for (const r of dyn) console.log(`DYNAMIC ${r.file}:${r.line} ${r.dynamic}`);
const out = process.argv.indexOf('--json');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(results, null, 2));
process.exitCode = bad.length ? 1 : 0;
