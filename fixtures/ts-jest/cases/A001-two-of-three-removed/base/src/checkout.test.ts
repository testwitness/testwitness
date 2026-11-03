// @ts-nocheck
import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a receipt with tax', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt.subtotal).toBe(10);
    expect(receipt.tax).toBe(1);
    expect(receipt.total).toBe(11);
  });

  it('keeps the lines', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.lines).toHaveLength(1);
  });
});
