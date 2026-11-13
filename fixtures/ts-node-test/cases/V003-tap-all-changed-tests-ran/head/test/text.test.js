const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const { slugify, clamp } = require('../src/text');

describe('Text', () => {
  describe('slugify', () => {
    it('lowercases and joins with dashes', () => {
      assert.equal(slugify('Hello Big World'), 'hello-big-world');
    });

    it('strips leading and trailing separators', () => {
      assert.equal(slugify('  --Hi!  '), 'hi');
    });

    it.skip('handles unicode', () => {
      assert.equal(slugify('Ünïcode'), 'unicode');
    });

    it.todo('keeps numbers');

    it('fails on purpose', () => {
      assert.equal(slugify('A B'), 'a_b');
    });
  });
});

describe('Numbers', () => {
  it('clamps below the range', () => {
    assert.equal(clamp(-5, 0, 10), 0);
  });

  it('clamps above the range', () => {
    assert.equal(clamp(500, 0, 10), 10);
  });
});

test('clamp table', async (t) => {
  await t.test('inside the range', () => {
    assert.equal(clamp(5, 0, 10), 5);
  });
  await t.test('at the edge', () => {
    assert.equal(clamp(0, 0, 10), 0);
  });
});
