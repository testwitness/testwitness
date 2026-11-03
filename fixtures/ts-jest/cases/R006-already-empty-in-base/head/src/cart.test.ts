import { total } from './cart';

describe('cart', () => {
  it('handles empty', () => {
  });

  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }])).toBe(10);
  });
});
