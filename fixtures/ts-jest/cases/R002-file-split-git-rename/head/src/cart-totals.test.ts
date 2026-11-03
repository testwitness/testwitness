// @ts-nocheck
import { total } from './cart';

describe('cart totals', () => {
  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(13);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
