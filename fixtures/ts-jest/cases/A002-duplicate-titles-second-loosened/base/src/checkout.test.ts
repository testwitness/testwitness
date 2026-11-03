// @ts-nocheck
import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a receipt', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.total).toBe(10);
  });

  it('builds a receipt', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt.total).toBe(11);
  });
});
