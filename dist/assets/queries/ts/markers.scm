;; Inline skip, focus, fixme and expected failure markers that live inside a
;; test or describe body rather than on the declaration itself.
;;
;; Declaration level markers (it.skip, test.only, xit, describe.skip,
;; test.fixme('title', fn), test.fails, test.skipIf(cond), test.todo) are
;; derived from the callee chain of the declaration matched by tests.scm.

;; Mocha: this.skip(), this.retries(n), this.timeout(n)
((call_expression
   function: (member_expression
     object: (this)
     property: (property_identifier) @prop)) @call
 (#match? @prop "^(skip|retries|timeout)$"))

;; Playwright inline: test.skip(), test.skip(cond, reason), test.fixme(), test.fail(), test.slow()
;; Also test.setTimeout(n). The chain analysis decides whether a match is an
;; inline marker (no title argument) or a declaration (title plus body).
((call_expression
   function: (member_expression
     object: (identifier) @root
     property: (property_identifier) @prop)) @call
 (#match? @root "^(test|it)$")
 (#match? @prop "^(skip|fixme|fail|slow|setTimeout)$"))
