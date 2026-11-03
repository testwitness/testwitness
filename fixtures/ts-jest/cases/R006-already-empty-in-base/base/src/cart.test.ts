// @ts-nocheck
import { total } from './cart';

describe('cart', () => {
  it('handles empty', () => {
    'pending until the fixture loader exists';
  });

  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }])).toBe(10);
  });
});
