;; Mock and stub declarations (spec section 1.6, M001).

;; mock.patch("app.x"), patch("app.x"), mocker.patch("app.x"),
;; patch.object(T, "attr"), mock.patch.object(T, "attr"),
;; patch.dict("os.environ", ...), monkeypatch.setattr(T, "attr", v),
;; monkeypatch.setattr("app.x", v), as a call anywhere (statement,
;; decorator or with item).
(call
  function: [
    (identifier) @mock.callee
    (attribute) @mock.callee
  ]
  arguments: (argument_list) @mock.args
  (#match? @mock.callee "(^|\\.)(patch|patch\\.object|patch\\.dict|patch\\.multiple|setattr|setitem|setenv)$")) @mock.call
