// @ts-nocheck
import { addLine } from './cart';

describe('cart validation', () => {
  it('accepts a zero quantity', () => {
    expect(addLine([], { sku: 'A1', qty: 0, unitPrice: 5 })).toHaveLength(1);
  });

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
