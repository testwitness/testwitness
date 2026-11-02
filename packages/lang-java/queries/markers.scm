;; Skip and conditional skip markers (tree-sitter-java).
;; @Disabled, @Disabled("reason"), the @Disabled* conditional family,
;; @Ignore, @Test(enabled = false), @EnabledIf("false").
;; Assumptions used as the first statement of a body (assumeTrue(false),
;; assumeFalse(true), Assumptions.abort(), throw new SkipException(..))
;; are matched by the second pattern and resolved in src/inventory.ts.

(marker_annotation name: (_) @marker.name) @marker
(annotation
  name: (_) @marker.name
  arguments: (annotation_argument_list) @marker.args) @marker

(method_invocation
  name: (identifier) @assumption.name
  (#match? @assumption.name "^(assumeTrue|assumeFalse|assumeThat|assumingThat|abort|assumeNoException|assumeNotNull)$")) @assumption

(throw_statement
  (object_creation_expression
    type: (_) @skipexception.type
    (#match? @skipexception.type "SkipException$"))) @skipexception
