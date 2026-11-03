// @ts-nocheck
import { total } from './cart';

describe('cart', () => {
  for (const qty of [1, 2, 3]) {
    it(`totals quantity ${qty}`, () => {
      expect(total([{ sku: 'A1', qty, unitPrice: 5 }])).toBe(qty * 5);
    });
  }

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
