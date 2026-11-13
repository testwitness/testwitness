import type { Rule } from '../types.js';
import { rulesR } from './R.js';
import { rulesO } from './O.js';
import { rulesA } from './A.js';
import { rulesV } from './V.js';
import { rulesW } from './W.js';
import { rulesE } from './E.js';
import { rulesC } from './C.js';
import { rulesM } from './M.js';

export * from './R.js';
export * from './O.js';
export * from './A.js';
export * from './V.js';
export * from './W.js';
export * from './E.js';
export * from './C.js';
export * from './M.js';
export * from './util.js';

/** Built in rules in catalogue order. */
export function builtinRules(): Rule[] {
  return [...rulesR(), ...rulesA(), ...rulesO(), ...rulesM(), ...rulesE(), ...rulesW(), ...rulesC(), ...rulesV()];
}

export function ruleMap(rules: Rule[] = builtinRules()): Map<string, Rule> {
  const m = new Map<string, Rule>();
  for (const r of rules) {
    if (m.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
    m.set(r.id, r);
  }
  return m;
}
