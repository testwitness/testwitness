// @ts-nocheck
const assert = require('assert');
const { slugify, clamp } = require('../lib');

describe('Text', function () {
  describe('slugify', function () {
    it('lowercases and joins with dashes', function () {
      assert.strictEqual(slugify('Hello World'), 'hello-world');
    });

    it('strips leading and trailing separators', function () {
      assert.strictEqual(slugify('  --Hi!  '), 'hi');
    });

    it.skip('handles unicode', function () {
      assert.strictEqual(slugify('Ünïcode'), 'unicode');
    });

    it('is pending without a callback');

    it('fails on purpose', function () {
      assert.strictEqual(slugify('A B'), 'a_b');
    });
  });

  describe.skip('future work', function () {
    it('will be implemented later', function () {
      assert.ok(false);
    });
  });
});

describe('Numbers', function () {
  it('clamps below the range', function () {
    assert.strictEqual(clamp(-5, 0, 10), 0);
  });

  it('clamps above the range', function () {
    assert.strictEqual(clamp(50, 0, 10), 10);
  });
});
