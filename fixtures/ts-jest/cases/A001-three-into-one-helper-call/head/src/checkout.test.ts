import { checkout, type Receipt } from './checkout';

function expectReceipt(receipt: Receipt, subtotal: number, tax: number, total: number) {
  expect(receipt.subtotal).toBe(subtotal);
  expect(receipt.tax).toBe(tax);
  expect(receipt.total).toBe(total);
}

describe('checkout', () => {
  it('builds a receipt with tax', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expectReceipt(receipt, 10, 1, 11);
  });

  it('keeps the lines', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.lines).toHaveLength(1);
  });
});
