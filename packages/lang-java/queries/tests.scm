;; Test declarations (tree-sitter-java).
;; Every annotated method is a candidate. The framework tables in
;; src/frameworks.ts decide which annotations make a method a test
;; (@Test, @ParameterizedTest, @RepeatedTest, @TestFactory, @TestTemplate).
;; Methods without a body (abstract) are dropped in src/inventory.ts.

(method_declaration
  (modifiers
    [
      (marker_annotation name: (_) @test.annotation)
      (annotation name: (_) @test.annotation)
    ])
  name: (identifier) @test.name) @test.method

;; Containers. Nested classes give Outer$Inner qualified names.
(class_declaration name: (identifier) @container.name) @container
(interface_declaration name: (identifier) @container.name) @container
(enum_declaration name: (identifier) @container.name) @container
(record_declaration name: (identifier) @container.name) @container
