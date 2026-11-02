import { checkout } from './checkout';

describe('checkout', () => {
  it('loads the receipt', async () => {
    const receipt = Promise.resolve(checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0));
    await expect(receipt).resolves.toEqual({ subtotal: 10, tax: 0, total: 10, lines: [{ sku: 'A1', qty: 2, unitPrice: 5 }] });
  });
});
