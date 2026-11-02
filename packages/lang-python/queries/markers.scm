;; Skip, xfail and conditional skip markers (spec section 1.1, R001 to R010).

;; Decorators on functions and classes: pytest.mark.skip, skipif, xfail,
;; unittest.skip, skipIf, skipUnless, expectedFailure.
(decorator) @marker.decorator

;; pytest.skip(...) or self.skipTest(...) called as a statement; inventory.ts
;; checks that it is the first statement of the body.
(expression_statement
  (call
    function: (attribute
      object: (_) @marker.call.receiver
      attribute: (identifier) @marker.call.name)
    arguments: (argument_list) @marker.call.args)
  (#match? @marker.call.name "^(skip|skipTest|importorskip)$")) @marker.call

;; raise unittest.SkipTest("reason") or raise SkipTest("reason").
(raise_statement
  (call
    function: (_) @marker.raise.callee
    arguments: (argument_list) @marker.raise.args)
  (#match? @marker.raise.callee "(^|\\.)SkipTest$")) @marker.raise
