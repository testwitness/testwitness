const { total } = require('./billing');

test('totals', () => {
  expect(total([1, 2])).toBe(3);
});
