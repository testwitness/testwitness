# Contributing

Thank you. The bar is simple: every rule change comes with golden fixtures and a corpus run, because a tool that measures tests has to measure itself.

## Setup

```bash
pnpm install
pnpm check            # typecheck, lint, unit tests
pnpm fixtures         # golden cases (about two minutes)
pnpm corpus:report    # precision on the public PR corpus; writes docs/precision.md
```

Node 22 or newer and pnpm 10 for development (Stryker 10 needs Node 22). The published CLI itself runs on Node 20 or newer, and CI proves that on every change. The fixture projects under `fixtures/*/project` are real projects; their JUnit XML was produced by running them and must never be edited by hand (see `fixtures/JUNIT-FIXTURES.md`).

## Adding a rule

1. Read `docs/conventions.md` and the rule catalogue in the spec.
2. Add the rule in `packages/core/src/rules/<Group>.ts` with `docs.summary`, `docs.falsePositives` and `docs.example` filled in. Write the false positive controls first.
3. Unit tests next to it using `rules/testkit.ts` (no tree-sitter needed).
4. At least three positive and three negative golden cases per language it supports under `fixtures/<project>/cases/<RULE>-<slug>/` (`base/`, `head/`, `expected.json`, `README.md`).
5. Run the corpus. A rule that produces medium or high findings on honest entries does not ship until the control is written.

## Adding a framework

Extend the framework table in `packages/lang-<x>/src/frameworks.ts` (test call names, modifiers, assertion shapes, lattice entries, mock shapes), add unit tests with inline sources, and add a fixture project with real JUnit XML.

## Adding a language

Implement `LanguageFrontEnd` from `@testwitness/core` in a new `packages/lang-<x>` package following `docs/conventions.md`, with `.scm` queries, a framework table, unit tests and a fixture project.

## Reporting a false positive

Open an issue with the minimal diff and the finding JSON. Every confirmed false positive becomes a corpus entry before the fix merges.

## Style

TypeScript strict, ESM, conventional commits. Prose in docs and messages uses commas and full stops rather than dashes.

## Support policy

JUnit XML is the contract. Framework specific niceties are best effort.

## Maintainer exit plan

If this project stops being maintained, the README will say so and point at a successor or the archived state. An abandoned repository without a note is worse than none.
