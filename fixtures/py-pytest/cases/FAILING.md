# Python golden cases that fail against the current core rules

These cases are left in place on purpose. Each one encodes the behaviour the rule's own documentation or the fixture convention asks for, the engine currently disagrees, and the fix belongs in packages/core, which the Python fixture work does not edit. Remove an entry here when the core change lands and the case passes.

## R001-production-module-deleted

Actual findings: `[{"ruleId":"R001","severity":"high","subject":"test_percentage_discount_applies"}]`

Expected: `[]`

Diagnosis: core. The PR deletes app/discounts.py and the one test that imported it. R001 has no control for a deleted test whose production module is deleted in the same PR, and `exercisesChangedProduction` treats the deleted module as a changed one, so the deletion is even escalated to high. A deleted feature cannot lose coverage. Suggested fix in R001: when every changed production stem the test file imports belongs to a file whose status is `deleted`, report low with a label such as `production removed`, or suppress entirely.

## R002-production-module-deleted-with-its-tests

Actual findings: `[{"ruleId":"R002","severity":"high","subject":"tests/test_discounts.py"}]`

Expected: `[]`

Diagnosis: core. Same gap as above at file level. tests/test_discounts.py is deleted together with app/discounts.py, the only module it imports. R002 only knows the moved control, so it reports the file at high. Suggested fix in R002: when the deleted test file's imports resolve only to production files deleted in the same PR (name convention `test_x.py` for `x.py` or an import of that stem), report low with a `production removed` label.

## O006-tests-package-init

Actual findings: `[{"ruleId":"O006","severity":"medium","subject":"tests/__init__.py"}]`

Expected: `[]`

Diagnosis: core classification. An empty tests/__init__.py matches the `**/tests/**/*.py` default test glob, so the engine builds an inventory with no tests and O006 reports it. `__init__.py` is a package marker, never a test module. The Python front end's own `isTestFile` is not consulted by the engine, so this cannot be fixed in packages/lang-python. Suggested fix: exclude `__init__.py` in `classifyPath` (treat it as `other` or `production`), or have O006 skip empty files and `__init__.py`.

## A009-identifier-starting-with-true

Actual findings: `[{"ruleId":"A009","severity":"medium","subject":"test_true_up_entry_is_balanced"},{"ruleId":"O002","severity":"low","subject":"test_true_up_entry_is_balanced","label":"smoke"}]`

Expected: `[{"ruleId":"O002","severity":"low","subject":"test_true_up_entry_is_balanced","label":"smoke"}]`

Diagnosis: core. `assert TrueUpEntry(ledger).balanced` has a subject but no expected operand, so `isTautology` falls back to its text pattern. The first alternative of that pattern, `^(assertTrue|assert|...)\(?(true|True)\)?`, has no end anchor and no word boundary, so the normalised text `assertTrueUpEntry(ledger).balanced` matches on the prefix `assertTrue`. Any truthiness assertion whose subject starts with `True` (TrueUp is a real ledger term) is reported as a tautology. Suggested fix: anchor the fallback with `$` after the optional closing parenthesis, or require that the whole normalised text equals `assertTrue`, `assert(True)` or `assertTrue(True)` style forms. The front end now populates `expected` for two operand comparisons, so the fallback is only reached for one operand assertions like this one.
