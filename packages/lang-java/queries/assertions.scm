;; Assertion call shapes (tree-sitter-java).
;; Every method invocation is a candidate anchor. src/inventory.ts walks up
;; to the outermost call of the chain (assertThat(x).as("d").isEqualTo(y))
;; and classifies it against the A001 sets and A002 lattice in
;; src/frameworks.ts. Lambda bodies passed to assertThrows and assertAll are
;; part of the same statement and are visited through their arguments.

(method_invocation
  name: (identifier) @call.name) @call

;; @Test(expected = X.class) and @Test(expectedExceptions = X.class) count as
;; exception assertions on the test they annotate.
(annotation
  name: (_) @expected.annotation
  arguments: (annotation_argument_list
    (element_value_pair
      key: (identifier) @expected.key
      value: (_) @expected.value))) @expected
