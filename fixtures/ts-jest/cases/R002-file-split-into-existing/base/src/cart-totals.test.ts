import { total } from './cart';

describe('cart totals', () => {
  it('ignores a zero quantity line', () => {
    expect(total([{ sku: 'A1', qty: 0, unitPrice: 5 }])).toBe(0);
  });
});
