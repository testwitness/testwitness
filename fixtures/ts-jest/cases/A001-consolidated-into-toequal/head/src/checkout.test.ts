// @ts-nocheck
import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a receipt with tax', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt).toEqual({ subtotal: 10, tax: 1, total: 11, lines: [{ sku: 'A1', qty: 2, unitPrice: 5 }] });
  });

  it('keeps the lines', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.lines).toHaveLength(1);
  });
});
