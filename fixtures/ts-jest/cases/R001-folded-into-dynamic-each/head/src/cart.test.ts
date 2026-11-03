// @ts-nocheck
import { total } from './cart';
import { totalCases } from './cart-cases';

describe('cart', () => {
  test.each(totalCases())('totals %j to %i', (lines, expected) => {
    expect(total(lines)).toBe(expected);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
