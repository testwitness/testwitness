;; Test and container declarations for Jest, Vitest, Mocha and Playwright Test.
;; Every pattern captures the outermost call as @call and the root identifier
;; of the callee chain as @root. The chain itself (modifiers, each tables,
;; skipIf conditions) is analysed in src/inventory.ts, which also drops inner
;; matches such as the `test.each(table)` call nested inside
;; `test.each(table)('title', fn)`.
;;
;; Roots:
;;   tests        it test specify xit xtest xspecify fit ftest fspecify
;;   containers   describe context suite xdescribe xcontext xsuite fdescribe fcontext fsuite
;;   playwright   test.describe (root test, handled by the chain analysis)
;;   qunit        QUnit.test, QUnit.module and QUnit.test<Name> wrappers

;; it('title', fn)
((call_expression
   function: (identifier) @root) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))

;; it.skip('title', fn), test.describe('title', fn)
((call_expression
   function: (member_expression
     object: (identifier) @root)) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))

;; QUnit.test('title', function (assert) {}), QUnit.module('name', fn), QUnit.testUnlessIE('title', fn)
((call_expression
   function: (member_expression
     object: (identifier) @root)) @call
 (#eq? @root "QUnit"))

;; test.describe.only('title', fn), test.concurrent.skip('title', fn)
((call_expression
   function: (member_expression
     object: (member_expression
       object: (identifier) @root))) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))

;; test.describe.serial.only('title', fn)
((call_expression
   function: (member_expression
     object: (member_expression
       object: (member_expression
         object: (identifier) @root)))) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))

;; test.each(table)('title', fn), it.skipIf(cond)('title', fn)
((call_expression
   function: (call_expression
     function: (member_expression
       object: (identifier) @root))) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))

;; test.skip.each(table)('title', fn), describe.only.each(table)('title', fn)
((call_expression
   function: (call_expression
     function: (member_expression
       object: (member_expression
         object: (identifier) @root)))) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))

;; test.concurrent.skip.each(table)('title', fn)
((call_expression
   function: (call_expression
     function: (member_expression
       object: (member_expression
         object: (member_expression
           object: (identifier) @root))))) @call
 (#match? @root "^(it|test|specify|describe|context|suite|xit|xtest|xspecify|xdescribe|xcontext|xsuite|fit|ftest|fspecify|fdescribe|fcontext|fsuite)$"))
