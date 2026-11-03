// @ts-nocheck
import { addLine, total } from './cart';

describe('cart', () => {
  it('adds a line', () => {
    const lines = addLine([], { sku: 'A1', qty: 1, unitPrice: 5 });
    expect(total(lines)).toBe(5);
  });
});
