;; Test declarations for pytest and unittest.
;; Every function definition is captured; inventory.ts applies the collection
;; rules (test prefix, enclosing Test* class or TestCase subclass, fixtures).

(function_definition
  name: (identifier) @test.name) @test.def

(class_definition
  name: (identifier) @class.name) @class.def

;; Module level pytestmark assignment (single mark or list of marks).
(module
  (expression_statement
    (assignment
      left: (identifier) @pytestmark.name
      right: (_) @pytestmark.value))
  (#eq? @pytestmark.name "pytestmark"))

(import_statement) @import
(import_from_statement) @import
