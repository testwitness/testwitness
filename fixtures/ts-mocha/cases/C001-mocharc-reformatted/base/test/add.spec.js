const assert = require('assert');
const { add } = require('../lib');

describe('add', () => {
  it('adds', () => {
    assert.strictEqual(add(1, 2), 3);
  });
});
