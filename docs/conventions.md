# Engineering conventions

Read this before touching any package. The spec is the source of truth; this
page is the contract between packages so parallel work fits together.

## Repository rules

- TypeScript, strict, ESM. Node 22 or newer for development; the published CLI supports Node 20 or newer. `verbatimModuleSyntax` is on, so
  type imports use `import type`.
- Tests: vitest, files named `*.test.ts` next to the code. Property tests use
  fast-check. Every exported function with logic has a test.
- Do not add dependencies without a reason written in the PR or LOG.md. Never
  run `pnpm install` while another task may be running it; the lockfile is
  shared. Everything needed for the language and junit packages is installed.
- No network calls at runtime anywhere in the tool. No execution of scanned
  repository code. No model calls.
- Prose in docs and messages: no dashes (use commas or full stops). Hyphens are
  fine inside code, file names, flags and YAML keys.
- Run `pnpm typecheck && pnpm lint && pnpm test` before declaring anything done,
  and read the output.

## Language front end contract (`packages/lang-*`)

Each language package exports one object implementing `LanguageFrontEnd` from
`@testwitness/core` (see `packages/core/src/types.ts`), plus its framework
tables. Layout:

```
packages/lang-<x>/
  package.json
  queries/            # tree-sitter .scm files, one per concept
    tests.scm         # test declarations
    assertions.scm    # assertion call shapes
    markers.scm       # skip, focus, todo, fixme, xfail markers
    mocks.scm         # mock and stub declarations
  src/
    index.ts          # export const <lang>FrontEnd: LanguageFrontEnd
    grammar.ts        # resolves and loads the bundled wasm via core/loadLanguage
    frameworks.ts     # FrameworkTable[] (names, modifiers, assertion sets, lattice)
    inventory.ts      # builds TestInventory from a Tree
    *.test.ts
```

Grammar loading: use `createRequire(import.meta.url).resolve('tree-sitter-java/tree-sitter-java.wasm')`
and `loadLanguage(path)` from core. Queries are read from the `queries/`
directory relative to the package (`new URL('../queries/tests.scm', import.meta.url)`)
and compiled once with `compileQuery`.

### TestInventory field rules

- `qualifiedName` never contains the file path (the inventory already has it).
  - Java: `OuterClass$Inner#methodName`.
  - TypeScript and JavaScript: describe titles and the test title joined with
    ` › ` (space, U+203A, space), for example `Billing › charge › rejects expired cards`.
    Template literal or dynamic titles use the raw source text of the argument.
  - Python: `TestClass::test_name` for methods, `test_name` for functions.
- `name` is the last segment of the qualified name.
- `container` is the list of enclosing class or describe titles, outermost first.
- `bodyHash` is `shortHash(normaliseText(bodyText))` over the body only, never
  the name, so a renamed test with the same body hashes the same.
- `statementCount` counts executable statements in the body and excludes:
  `pass`, bare `return` with no value, docstrings and string literal expression
  statements, comments, `TODO` only lines. A body of only `pass` is 0.
- `assertions` lists every assertion statement using the sets in spec section
  1.2 (A001). Classify `kind`:
  - `value`: equality, comparison, matcher on a returned value.
  - `state`: assertion on an object or collection state the subject mutated
    (use `value` when you cannot tell; `state` is best effort).
  - `interaction`: `verify(...)`, `toHaveBeenCalled*`, `assert_called*`.
  - `exception`: `assertThrows`, `pytest.raises`, `toThrow`, `@Test(expected=)`,
    `assertRaises`.
  - `snapshot`: `toMatchSnapshot`, `toMatchInlineSnapshot`, approval style.
  - `smoke`: `assertNotNull`, `toBeDefined`, `toBeTruthy`, `isNotNone`,
    `assertDoesNotThrow`, `not.toThrow()` alone, `instanceof` checks.
  - `custom`: a call to a function defined in the same file whose body
    contains assertions (one level deep), or a name in `profile.extraAssertions`.
  - `callee` is the normalised call, for example `assertEquals`,
    `assertThat.isEqualTo`, `expect.toBe`, `expect.not.toBe`, `assert` (pytest
    bare assert), `self.assertEqual`, `verify`, `pytest.raises`.
  - `subject` is the normalised source of the thing asserted on when
    identifiable (first argument of `expect`, the actual operand of
    `assertEquals`, the left side of a pytest `==`).
  - `family` and `strength` follow the A002 lattice tables in `frameworks.ts`
    (higher is stronger). Leave undefined when not in a known family. Core
    also reads every assertion onto one lattice shared by all languages
    (`packages/core/src/assertion-meaning.ts`) from `callee`, `subject` and
    `expected`; a front end only needs to keep those three faithful.
  - `matcher` is set when the callee does not carry the matcher: the
    comparison operator of a bare Python assert (`==`, `in`, `is not`, `>=`),
    `truthy` or `not` for a bare truthiness check.
- `locals` (optional, per test): names bound once in the test body mapped to
  the initialiser text. A002 follows a subject through a binding whose
  initialiser projects another plain reference.
- `embedded` (optional, per test): matcher checks nested in a project helper
  or matcher that is not an assertion of its own (a Hamcrest matcher passed to
  `event.hasValueMatching(...)`, an expectation object passed to a project
  `toMatch({...})`). A002 compares them; A001 and O001 never count them.
- `helperAssertions` (optional, per file): the assertions inside each
  assertion helper, by helper name. A002 compares them across base and head.
- `markers` are per test. `kind`: `skip`, `focus`, `todo`, `fixme`, `xfail`,
  `conditional-skip`. Set `constant: true` when the condition is a literal
  `true`/`True` or the marker is unconditional. Set `reason` when a reason
  string is present. Include class level and describe level markers on every
  test they cover (and record them in `fileMarkers` when module level).
- `parameterCount`: number of literal cases in `@ValueSource`, `@CsvSource`,
  `test.each` tables, `@pytest.mark.parametrize` lists; undefined when dynamic
  (`@MethodSource`, a variable) or absent.
- `mocks`: normalised mock targets (`jest.mock('../billing')` gives
  `../billing`; `@Mock BillingService` gives `BillingService`;
  `mock.patch('app.billing.charge')` gives `app.billing.charge`).
- `framework`: detected per file from imports and annotations, one of
  `junit5`, `junit4`, `testng`, `jest`, `vitest`, `mocha`, `playwright`,
  `qunit`, `pytest`, `unittest`; fall back to the profile, then to the language default
  (`junit5`, `jest`, `pytest`).
- `assertionHelpers`: names of functions defined in the file whose body has an
  assertion and whose name does not make it a test.
- `parseErrors`: `countParseErrors(tree.rootNode)`.

### isTestFile

Path patterns per spec R002 plus a content sniff when the path is unusual
(`describe(` and `it(`/`test(` present; `@Test` present; `def test_` present).

## Fixture convention (`fixtures/`)

```
fixtures/<lang>-<framework>-<build>/     e.g. java-junit5-maven, ts-jest, py-pytest
  project/                 # a tiny real project that builds and runs
  junit/                   # real XML produced by the real runner, committed
  results/<format>/        # real TAP or JSON reporter output (tap, jest-json, vitest-json, pytest-json-report, playwright-json)
  cases/<rule>-<slug>/
    base/                  # files as they are before the PR (relative to project root)
    head/                  # files after the PR; a missing file means deleted
    expected.json          # golden findings: [{ruleId, severity, subject, label?}]
    README.md              # one paragraph: what the case is and why it is positive or negative
    junit/ or results/     # results of the head run; results/ takes any format the reader knows
    CRLF                   # optional: write the case with Windows line endings (below)
```

### CRLF cases

Windows repositories commit CRLF, and a PR may convert files between CRLF and
LF while it edits them. A case directory with a `CRLF` file is written with
CRLF line endings by the runner (`fixtures/runner/golden.ts`), and the
temporary repository sets `core.autocrlf false` so git stores the CRLF bytes.
One directive per line:

- `twin <case>`: take `base/`, `head/`, `expected.json`, `pr.json` and the
  result, coverage, mutation and history inputs from that LF case of the same
  project. The suite then requires exactly the findings of the twin, line
  numbers, messages and fingerprints included.
- `sides base|head|both` (default `both`): which commit gets CRLF. The head
  side also converts the PR body and the result, coverage, mutation and
  history inputs. `twin X` with `sides head` is a PR that converts to CRLF
  while it edits; `sides base` one that converts to LF.
- `from <case>`: take only `base/` and `head/` from that case, without its
  expectations.
- `head base`: the head commit is the base files again, so the PR only
  converts line endings and `expected.json` is `[]`.

Names: `<twin>-crlf` (both sides), `<twin>-mixed` (head only),
`<twin>-crlf-to-lf` (base only), `CRLF-only-*` (line endings only).

A case is positive when `expected.json` lists findings and negative when it is
`[]`. Negative cases must cover the false positive controls named in the spec:
tests renamed, moved to another file, parametrised folds, helper extraction,
conditional skips with constants that fold to false, reason strings that
reference an issue.

## Test results fixtures (`fixtures/<x>/junit/`, `fixtures/<x>/results/<format>/`)

Always produced by running the real framework. Never hand written. Record the
producer and version in a `PRODUCER.md` next to the files. A positive V003 case
derives its results from the real file by removing one named record, with
`fixtures/runner/derive-results.ts` for TAP and JSON.
