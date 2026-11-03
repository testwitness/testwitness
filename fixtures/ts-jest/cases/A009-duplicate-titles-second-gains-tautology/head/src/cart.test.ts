// @ts-nocheck
import { total } from './cart';

describe('cart', () => {
  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  it('handles empty', () => {
    expect(total([{ sku: 'A1', qty: 0, unitPrice: 5 }])).toBe(0);
    expect(true).toBe(true);
  });
});
