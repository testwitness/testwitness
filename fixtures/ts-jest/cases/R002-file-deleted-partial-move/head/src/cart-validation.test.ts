// @ts-nocheck
import { addLine } from './cart';

describe('cart validation', () => {
  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
