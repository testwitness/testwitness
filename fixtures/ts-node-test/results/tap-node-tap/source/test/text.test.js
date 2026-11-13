const t = require('tap');
const { slugify, clamp } = require('../text');

t.test('Text', async (t) => {
  t.test('slugify', async (t) => {
    t.test('lowercases and joins with dashes', async (t) => {
      t.equal(slugify('Hello World'), 'hello-world');
    });
    t.test('handles unicode', { skip: 'not supported yet' }, async (t) => {
      t.equal(slugify('Ünïcode'), 'unicode');
    });
    t.test('keeps numbers', { todo: true });
    t.test('fails on purpose', async (t) => {
      t.equal(slugify('A B'), 'a_b');
    });
  });
});

t.test('Numbers', async (t) => {
  t.test('clamps below the range', async (t) => {
    t.equal(clamp(-5, 0, 10), 0);
  });
});
