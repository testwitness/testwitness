const { test } = require('node:test');
const assert = require('node:assert/strict');

test('counts with a plan', (t) => {
  t.plan(2);
  t.assert.equal(1 + 1, 2);
  t.assert.equal(2 + 2, 4);
});

test('skipped with a reason', { skip: 'waiting on the upstream fix' }, () => {
  assert.fail('never runs');
});

test('todo that fails', { todo: 'not finished' }, () => {
  assert.equal(1, 2);
});
