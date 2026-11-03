// @ts-nocheck
import { total } from './cart';

describe('cart', () => {
  it('totals one line', () => {
    const t = total([{ sku: 'A1', qty: 1, unitPrice: 5 }]);
    expect(t).toBe(5);
    expect(Number.isInteger(t)).toBe(true);
  });
});
