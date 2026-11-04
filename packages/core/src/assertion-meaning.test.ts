import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RANK, matcherExpressionRank, meaningOf, normaliseSubject, readBoolean, relatedSubjects, splitTopLevel, subjectKey, wholeCall } from './assertion-meaning.js';
import type { Assertion } from './types.js';

const a = (callee: string, subject?: string, expected?: string, extra: Partial<Assertion> = {}): Assertion => ({
  callee,
  ...(subject !== undefined ? { subject } : {}),
  ...(expected !== undefined ? { expected } : {}),
  text: `${callee}(${subject ?? ''})`,
  line: 1,
  kind: 'value',
  ...extra,
});

/** Plain references: names, member access and literal index access. */
const identifier = fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,7}$/).filter((s) => !/^(in|is|not|and|or|for|if|len|str|list|set|all|any|await|yield|new|true|false|null|None|True|False|undefined)$/.test(s));
const path = fc
  .tuple(identifier, fc.array(fc.oneof(identifier.map((s) => `.${s}`), fc.nat(9).map((n) => `[${n}]`)), { maxLength: 3 }))
  .map(([h, rest]) => h + rest.join(''))
  .filter((p) => !/\.(length|size|get|trim|strip|count|keys|values|items|lower|upper|text|json|map|replace|stream|sorted|toList|toArray|asList|decode|join|getText|getMessage|toString)$/.test(p));

/** Wrappers that read the same object as the path they wrap. */
const identityWrappers: Array<(p: string) => string> = [
  (p) => `${p}.length`,
  (p) => `${p}?.length`,
  (p) => `${p}.size()`,
  (p) => `${p}.count()`,
  (p) => `${p}.trim()`,
  (p) => `${p}.strip()`,
  (p) => `${p}.get()`,
  (p) => `${p}.toString()`,
  (p) => `len(${p})`,
  (p) => `str(${p})`,
  (p) => `String.valueOf(${p})`,
  (p) => `(${p})`,
  (p) => `await ${p}`,
  (p) => `{ ...${p}, createdAt: null }`,
  (p) => `[x.id for x in ${p}]`,
  (p) => `[x.id for x in ${p} if x.ok]`,
  (p) => `${p}.replace("\\n", "")`,
  (p) => `${p}!`,
];

describe('subject normalisation, properties', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(path, fc.array(fc.nat(identityWrappers.length - 1), { maxLength: 4 }), (p, ws) => {
        const wrapped = ws.reduce((acc, i) => identityWrappers[i]!(acc), p);
        const once = normaliseSubject(wrapped);
        expect(normaliseSubject(once)).toBe(once);
      }),
    );
  });

  it('strips every identity wrapper, nested in any order, back to the plain reference', () => {
    fc.assert(
      fc.property(path, fc.array(fc.nat(identityWrappers.length - 1), { minLength: 1, maxLength: 4 }), (p, ws) => {
        const wrapped = ws.reduce((acc, i) => identityWrappers[i]!(acc), p);
        expect(subjectKey(wrapped)).toBe(subjectKey(p));
      }),
    );
  });

  it('keeps distinct plain references distinct', () => {
    fc.assert(
      fc.property(path, path, (p, q) => {
        fc.pre(p !== q);
        expect(subjectKey(p)).not.toBe(subjectKey(q));
      }),
    );
  });

  it('never throws and always terminates on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), (subject, callee, expected) => {
        const m = meaningOf(a(callee || 'assert', subject, expected));
        expect(typeof m.subjectKey).toBe('string');
        normaliseSubject(subject);
        readBoolean(subject, false);
        matcherExpressionRank(expected);
      }),
    );
  });

  it('relates subjects symmetrically', () => {
    fc.assert(
      fc.property(path, path, (p, q) => {
        expect(relatedSubjects(p, q)).toBe(relatedSubjects(q, p));
      }),
    );
  });

  it('a reference is related to any part of itself', () => {
    fc.assert(
      fc.property(path, identifier, (p, f) => {
        expect(relatedSubjects(p, `${p}.${f}`)).toBe(true);
      }),
    );
  });
});

describe('subject normalisation, table', () => {
  it.each([
    ['result?.result?.trim()', 'result.result'],
    ['{ ...tx, blockHash: null }', 'tx'],
    ['aggregateEvents.length', 'aggregateEvents'],
    ['callCount.get()', 'callCount'],
    ['bodyOptional.get().replace("\\\\n", "").replace("\\n", "")', 'bodyOptional'],
    ['[featurestore.resource_name for featurestore in list_featurestores]', 'list_featurestores'],
    ['len(list_entity_types)', 'list_entity_types'],
    ['$("meta").length', '$("meta")'],
    ['values[0]', 'values[0]'],
    ['response.header("Content-Type")', 'response.header("Content-Type")'],
    ['d.get(k)', 'd.get(k)'],
    ['a + b.length', 'a+b.length'],
  ])('%s reads %s', (input, key) => {
    expect(subjectKey(input)).toBe(key);
  });

  it('follows a local bound once to a projection of another reference, and stops at a call', () => {
    const locals = { names: '[f.resource_name for f in features]', features: 'entity.list_features()', normalized: 'body.get().trim()' };
    expect(subjectKey('names', locals)).toBe('features');
    expect(subjectKey('normalized', locals)).toBe('body');
    expect(subjectKey('features', locals)).toBe('features');
  });

  it('splits on top level commas only', () => {
    expect(splitTopLevel('a, f(b, c), "d,e", [1, 2]')).toEqual(['a', 'f(b, c)', '"d,e"', '[1, 2]']);
    expect(wholeCall('x.y(1, 2)')).toMatchObject({ receiver: 'x', name: 'y', args: ['1', '2'] });
    expect(wholeCall('a + b(1)')).toBeUndefined();
    expect(wholeCall('/a(b)/.test(c)')).toMatchObject({ receiver: '/a(b)/', name: 'test', args: ['c'] });
  });
});

describe('rank lattice', () => {
  const rank = (x: Assertion) => meaningOf(x).rank;
  it('places equality, ordered, containment, bound, non empty and existence in order', () => {
    expect(rank(a('assertEquals', 'x', '1', { family: 'junit' }))).toBe(RANK.exact);
    expect(rank(a('expect.toMatch', 'x', '/^a\\d+$/', { family: 'value' }))).toBe(RANK.ordered);
    expect(rank(a('expect.toMatch', 'x', '/a\\d+/', { family: 'value' }))).toBe(RANK.partial);
    expect(rank(a('expect.toContain', 'x', '"a"', { family: 'value' }))).toBe(RANK.partial);
    expect(rank(a('expect.to.be.greaterThan', 'x.length', '1', { family: 'value' }))).toBe(RANK.bound);
    expect(rank(a('expect.toBeGreaterThan', 'x', '0', { family: 'value' }))).toBe(RANK.nonEmpty);
    expect(rank(a('assertNotNull', 'x', undefined, { family: 'junit' }))).toBe(RANK.exists);
    expect(rank(a('expect.toBeTruthy', 'x', undefined, { family: 'value' }))).toBe(RANK.exists);
  });

  it('unwraps boolean wrappers to the subject they test', () => {
    const contains = meaningOf(a('assertTrue', 'response.header("Content-Type").contains(FEED)', undefined, { family: 'junit' }));
    expect(contains).toMatchObject({ subjectKey: 'response.header("Content-Type")', rank: RANK.partial, viaWrapper: true });
    const bound = meaningOf(a('assertEquals', 'lowSeen.size() >= total - 2', 'true', { family: 'testng' }));
    expect(bound).toMatchObject({ subjectKey: 'lowSeen', rank: RANK.bound });
    const nonEmpty = meaningOf(a('assertTrue', 'lowSeen.size() > 0', undefined, { family: 'testng' }));
    expect(nonEmpty).toMatchObject({ subjectKey: 'lowSeen', rank: RANK.nonEmpty });
    const includes = meaningOf(a('expect.toBe', 'values.includes(expected)', 'expected !== undefined', { family: 'value' }));
    expect(includes).toMatchObject({ subjectKey: 'values', rank: RANK.partial });
    const subset = meaningOf(a('assert', 'all(root.inputs.get(k) == v for k, v in expected.items())', undefined, { matcher: 'truthy' }));
    expect(subset).toMatchObject({ subjectKey: 'root.inputs', rank: RANK.partial });
    const regex = meaningOf(a('assert', 're.fullmatch(r"INV-\\d+", invoice.number)', undefined, { matcher: 'truthy' }));
    expect(regex).toMatchObject({ subjectKey: 'invoice.number', rank: RANK.ordered });
    const empty = meaningOf(a('assertFalse', 'tasks.isEmpty()', undefined, { family: 'junit' }));
    expect(empty).toMatchObject({ subjectKey: 'tasks', rank: RANK.nonEmpty, negated: false });
  });

  it('keeps negative checks apart, except a count against zero and a value against null', () => {
    const negative = meaningOf(a('assertNotEquals', 'n', '5', { family: 'junit' }));
    expect(negative.negated).toBe(true);
    expect(negative.rank).toBeUndefined();
    expect(meaningOf(a('assertNotEquals', 'callCount.get()', '0', { family: 'junit' }))).toMatchObject({ negated: false, rank: RANK.nonEmpty, subjectKey: 'callCount' });
    expect(meaningOf(a('assert', 'x', 'None', { matcher: 'is not' }))).toMatchObject({ negated: false, rank: RANK.exists });
    expect(meaningOf(a('expect.not.toBe', 'x.length', '0', { family: 'value' }))).toMatchObject({ negated: false, rank: RANK.nonEmpty, subjectKey: 'x' });
    expect(meaningOf(a('expect.not.toContain', 'x', '"a"', { family: 'value' }))).toMatchObject({ negated: true });
    expect(meaningOf(a('assert', 'x', 'y', { matcher: 'not in' }))).toMatchObject({ negated: true });
  });

  it('reads Python membership on the container', () => {
    expect(meaningOf(a('assert', 'name', '[f.id for f in features]', { matcher: 'in' }))).toMatchObject({ subjectKey: 'features', rank: RANK.partial });
    expect(meaningOf(a('assert', 'body', '"12.50"', { matcher: 'in' }))).toMatchObject({ subjectKey: 'body', rank: RANK.partial });
    expect(meaningOf(a('self.assertIn', '"x"', 'items'))).toMatchObject({ subjectKey: 'items', rank: RANK.partial });
  });

  it('ranks Hamcrest and PyHamcrest matcher expressions, nested element matchers included', () => {
    expect(matcherExpressionRank('is(equalTo(4L))').rank).toBe(RANK.exact);
    expect(matcherExpressionRank('Matchers.greaterThan(1L)').rank).toBe(RANK.bound);
    const items = matcherExpressionRank("matches_all([hc.has_items('bicycle', 'dinosaur')])").rank!;
    const item = matcherExpressionRank("matches_all([hc.has_item(hc.contains_string('bicycle'))])").rank!;
    expect(items).toBeGreaterThan(item);
    expect(Math.floor(item)).toBe(RANK.partial);
    expect(matcherExpressionRank('not(equalTo(1))').negated).toBe(true);
    expect(meaningOf(a('assertThat.is', 'x.contains(y)', 'is(true)', { family: 'hamcrest' }))).toMatchObject({ subjectKey: 'x', rank: RANK.partial });
  });

  it('treats snapshots of the whole subject as exact and count declarations as off the lattice', () => {
    expect(meaningOf(a('expect.toMatchInlineSnapshot', '{ ...tx, blockHash: null }', '`{}`', { family: 'snapshot' }))).toMatchObject({ subjectKey: 'tx', rank: RANK.exact });
    expect(meaningOf(a('assert.expect', '2')).rank).toBeUndefined();
    expect(meaningOf(a('verify', 'mock', undefined, { kind: 'interaction', family: 'mockito' })).rank).toBeUndefined();
  });
});
