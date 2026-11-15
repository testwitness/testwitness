;; Assertion call shapes (spec section 1.2, A001).

;; Bare assert, including comparisons, truthiness and pytest.approx.
(assert_statement) @assert.bare

;; Context manager assertions: pytest.raises, pytest.warns,
;; pytest.deprecated_call, self.assertRaises, self.assertWarns.
(with_statement
  (with_clause
    (with_item
      value: (_) @assert.with.item))) @assert.with

;; Method style assertions: self.assertEqual, self.fail, numpy style
;; assert_array_equal, and mock assert_called* on any receiver.
(call
  function: (attribute
    object: (_) @assert.method.receiver
    attribute: (identifier) @assert.method.name)
  (#match? @assert.method.name "^(assert[A-Z_][A-Za-z_]*|fail)$")) @assert.method

;; Bare function assertion helpers such as `assert_frame_equal(a, b)` or
;; a helper imported from a module.
(call
  function: (identifier) @assert.function.name
  (#match? @assert.function.name "^assert[A-Z_][A-Za-z_]*$")) @assert.function

;; Any call statement: candidate for a custom assertion helper defined in
;; the same file.
(expression_statement
  (call) @call.statement)
