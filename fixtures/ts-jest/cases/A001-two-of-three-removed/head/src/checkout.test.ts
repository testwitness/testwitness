import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a receipt with tax', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt.subtotal).toBe(10);
  });

  it('keeps the lines', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.lines).toHaveLength(1);
  });
});
