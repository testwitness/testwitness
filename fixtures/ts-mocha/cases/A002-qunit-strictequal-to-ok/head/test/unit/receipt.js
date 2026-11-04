QUnit.module('receipt');

QUnit.test('reports the error position', function (assert) {
  var match = parse('<p>bad').error.match(/line (\d+) column (\d+)/);
  var line = match && match[1];
  var column = match && match[2];
  assert.ok(lineMatch(match), "reports line");
  assert.ok(columnMatch(match), "reports column");
});
