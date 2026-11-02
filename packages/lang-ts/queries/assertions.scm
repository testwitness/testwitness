;; Assertion candidates. An assertion is an expression that ends a statement,
;; a return value, or an expression bodied arrow function, whose callee chain
;; starts with expect(...), expect.soft(...), expect.poll(...), assert, or
;; contains a `.should` property (Chai should style), or is a call to a custom
;; assertion helper defined in the same file.
;;
;; The query only collects the candidate expressions. src/inventory.ts walks
;; the call and member chain to normalise the callee (for example
;; `expect.not.toBe`, `assert.strictEqual`, `should.equal`) and to classify
;; the assertion kind, family and strength from the frameworks table.

(expression_statement (_) @expr) @stmt

(return_statement (_) @expr) @stmt

;; () => expect(x).toBe(1)
(arrow_function body: (_) @expr) @stmt
