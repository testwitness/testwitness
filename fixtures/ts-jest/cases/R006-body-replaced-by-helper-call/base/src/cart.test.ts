// @ts-nocheck
import { addLine, total } from './cart';

describe('cart', () => {
  it('adds a line and totals it', () => {
    const lines = addLine([], { sku: 'A1', qty: 2, unitPrice: 5 });
    const result = total(lines);
    expect(result).toBe(10);
  });
});
