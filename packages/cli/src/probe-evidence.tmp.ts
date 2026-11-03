// Probe: for every fixture project, list inventory qualifiedNames, their candidate keys and whether the real XML has them.
import { readFileSync } from 'node:fs';
import fg from 'fast-glob';
import { inventoryKeys, isSkipped, isXfail } from '@testwitness/core';
import { readJunitFiles } from '@testwitness/junit';
import { javaFrontEnd } from '@testwitness/lang-java';
import { tsFrontEnd, jsFrontEnd } from '@testwitness/lang-ts';
import { pythonFrontEnd } from '@testwitness/lang-python';

const projects: Record<string, { fe: typeof javaFrontEnd; lang: 'java' | 'typescript' | 'javascript' | 'python'; glob: string }> = {
  'java-junit4-gradle': { fe: javaFrontEnd, lang: 'java', glob: 'src/test/java/**/*.java' },
  'java-testng-maven': { fe: javaFrontEnd, lang: 'java', glob: 'src/test/java/**/*.java' },
  'ts-jest': { fe: jsFrontEnd, lang: 'javascript', glob: 'src/**/*.test.js' },
  'ts-vitest': { fe: tsFrontEnd, lang: 'typescript', glob: 'src/**/*.test.ts' },
  'ts-playwright': { fe: tsFrontEnd, lang: 'typescript', glob: 'tests/**/*.spec.ts' },
  'ts-mocha': { fe: jsFrontEnd, lang: 'javascript', glob: 'test/**/*.js' },
  'py-pytest': { fe: pythonFrontEnd, lang: 'python', glob: 'tests/**/*.py' },
  'py-unittest': { fe: pythonFrontEnd, lang: 'python', glob: 'tests/**/*.py' },
};

const only = process.argv[2];
for (const [name, p] of Object.entries(projects)) {
  if (only && name !== only) continue;
  const root = `/home/claude/testwitness/fixtures/${name}`;
  const xmls = await fg(`${root}/junit/**/*.xml`);
  for (const xml of xmls.sort()) {
    const data = await readJunitFiles([xml]);
    console.log(`\n### ${name} :: ${xml.replace(root + '/junit/', '')}  (${data.records.size} keys)`);
    for (const k of data.records.keys()) console.log(`   xml ${k}`);
    const files = await fg(`${root}/project/${p.glob}`);
    for (const f of files.sort()) {
      const rel = f.replace(`${root}/project/`, '');
      const inv = await p.fe.inventory(rel, readFileSync(f, 'utf8'), { frameworks: new Set(), extraAssertions: [] });
      for (const t of inv.tests) {
        const keys = inventoryKeys(rel, t.qualifiedName, p.lang);
        const hit = keys.find((k) => data.records.has(k));
        const flag = hit ? 'OK  ' : isSkipped(t) || isXfail(t) ? 'skip' : 'MISS';
        console.log(`  ${flag} ${rel} :: ${t.qualifiedName}${hit ? ` -> ${hit}` : `  keys=${JSON.stringify(keys)}`}`);
      }
    }
  }
}
