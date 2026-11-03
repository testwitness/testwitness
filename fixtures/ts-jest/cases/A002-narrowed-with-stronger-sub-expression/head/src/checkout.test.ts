// @ts-nocheck
import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a receipt with tax', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt).toMatchObject({ subtotal: 10, tax: 1 });
    expect(receipt.total).toBe(11);
  });
});
