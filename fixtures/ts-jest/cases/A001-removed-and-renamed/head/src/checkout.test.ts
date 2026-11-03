import { checkout } from './checkout';

describe('checkout', () => {
  it('builds a taxed receipt', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expect(receipt.subtotal).toBe(10);
    expect(receipt.tax).toBe(1);
  });

  it('keeps the lines', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.lines).toHaveLength(1);
  });
});
