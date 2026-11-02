import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a receipt', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.subtotal).toBe(10);
    expect(receipt.total).toBe(10);
  });

  it('builds a receipt', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt.tax).toBe(1);
    expect(receipt.total).toBe(11);
  });
});
