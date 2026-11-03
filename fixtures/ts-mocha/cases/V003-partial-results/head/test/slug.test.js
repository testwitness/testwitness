// @ts-nocheck
const assert = require('assert');
const { slugify } = require('../lib');

describe('Slug', function () {
  it('keeps digits', function () {
    assert.strictEqual(slugify('a1 b2'), 'a1-b2');
  });
});
