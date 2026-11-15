;; Mock and stub declarations (tree-sitter-java).
;; Field level: @Mock, @MockBean, @MockitoBean, @Spy, @SpyBean, @MockitoSpyBean.
;; Body level: mock(X.class), Mockito.mock(X.class), spy(x), mockStatic(X.class),
;; mockConstruction(X.class). @Spy and spy() are partial mocks.

(field_declaration
  (modifiers
    [
      (marker_annotation name: (_) @mock.annotation)
      (annotation name: (_) @mock.annotation)
    ])
  type: (_) @mock.type) @mock.field

(method_invocation
  name: (identifier) @mock.call
  arguments: (argument_list) @mock.args
  (#match? @mock.call "^(mock|spy|mockStatic|mockConstruction)$")) @mock.invocation
