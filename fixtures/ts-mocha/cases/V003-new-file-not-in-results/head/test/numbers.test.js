const assert = require('assert');
const { clamp } = require('../lib');

describe('Clamp', function () {
  it('keeps a value inside the range', function () {
    assert.strictEqual(clamp(5, 0, 10), 5);
  });
});
