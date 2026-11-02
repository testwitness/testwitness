import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { grammarFor } from './grammar.js';
import { parseSource } from '@testwitness/core';
it('tree', async () => {
  const { language } = await grammarFor('typescript');
  const tree = parseSource(language, readFileSync(process.env.PROBE!, 'utf8'));
  const dump = (n: any, d = 0): string => `${'  '.repeat(d)}${n.type}${n.isMissing ? ' MISSING' : ''} [${n.startPosition.row + 1}]\n` + n.namedChildren.map((c: any) => dump(c, d + 1)).join('');
  console.log(dump(tree.rootNode));
});
