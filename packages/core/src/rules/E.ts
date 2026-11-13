import type { Finding, Rule } from '../types.js';
import { allChanges } from '../inventory.js';
import { makeFinding } from './util.js';

/** E001 Catch all added in a test. */
export const E001: Rule = {
  id: 'E001',
  name: 'Catch all added in a test',
  group: 'E',
  defaultSeverity: 'high',
  since: '0.1.0',
  languages: 'any',
  needs: ['diff', 'ast'],
  docs: {
    summary: 'A try block now wraps part of the test and its catch (Exception, Throwable, bare except, any JavaScript catch, or .catch(() => {})) neither rethrows, fails nor asserts. A failing subject call no longer fails the test.',
    falsePositives:
      'Cleanup wrappers with finally only are not catches. Catch blocks that assert on the exception, call fail(), or rethrow are not reported. Capture then assert is not reported either: a catch that stores the error in a variable the test asserts on after the try block, and `.catch((e) => e)` whose result is stored and asserted. A promise left running on purpose (`void call().catch(() => {})` as its own statement, with assertions after it) is reported low with the label background. A catch that existed in the base is not reported.',
    example: '+  try {\n+    svc.reconcile(ledger);\n+    assertEquals(0, ledger.drift());\n+  } catch (Exception e) {\n+    // ignore transient failures\n+  }',
  },
  run(ctx) {
    const out: Finding[] = [];
    for (const { pair, change } of allChanges(ctx.pairs)) {
      if (change.kind !== 'added' && change.kind !== 'modified' && change.kind !== 'renamed') continue;
      const head = change.head;
      const baseSnippets = new Set(change.kind === 'added' ? [] : (change.base.catchAlls ?? []).map((c) => c.snippet));
      for (const c of head.catchAlls ?? []) {
        if (!c.swallows) continue;
        if (baseSnippets.has(c.snippet)) continue;
        if (c.background) {
          out.push(
            makeFinding(ctx, 'E001', 'low', pair.file, head.qualifiedName, `Test ${head.qualifiedName} leaves ${c.snippet.slice(0, 60)} running in the background with an empty catch; its assertions come after it`, {
              line: c.line,
              after: `catch ${c.binding}`,
              label: 'background',
              snippet: c.snippet,
            }),
          );
          continue;
        }
        out.push(
          makeFinding(ctx, 'E001', 'high', pair.file, head.qualifiedName, `Test ${head.qualifiedName} now catches ${c.binding} around ${c.snippet.slice(0, 60)} and swallows it`, {
            line: c.line,
            after: `catch ${c.binding}`,
            snippet: c.snippet,
          }),
        );
      }
    }
    return out;
  },
};

export function rulesE(): Rule[] {
  return [E001];
}
