;; Mock and stub declarations.
;;
;;   jest.mock('../billing')            target ../billing
;;   jest.doMock('../billing')          target ../billing
;;   jest.unstable_mockModule('x')      target x
;;   vi.mock('../billing')              target ../billing
;;   vi.doMock('../billing')            target ../billing
;;   jest.spyOn(obj, 'method')          target obj.method
;;   vi.spyOn(obj, 'method')            target obj.method
;;   sinon.stub(obj, 'method')          target obj.method
;;   sinon.spy(obj, 'method')           target obj.method
;;   sinon.mock(obj)                    target obj
;;   sinon.replace(obj, 'method', fake) target obj.method
;;   td.replace('../billing')           target ../billing
;;   jest.fn() and vi.fn() carry no target and are ignored.

((call_expression
   function: (member_expression
     object: (identifier) @root
     property: (property_identifier) @prop)) @call
 (#match? @root "^(jest|vi|sinon|td|jasmine)$")
 (#match? @prop "^(mock|doMock|unstable_mockModule|spyOn|stub|spy|replace|replaceGetter|replaceSetter|createStubInstance|createSpyObj)$"))
