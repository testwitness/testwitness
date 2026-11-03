// @ts-nocheck
import { checkout, type Receipt } from './checkout';

function expectField(receipt: Receipt, field: keyof Receipt, value: number) {
  expect(receipt[field]).toBe(value);
}

describe('checkout', () => {
  it('builds a receipt with tax', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    expectField(receipt, 'subtotal', 10);
    expectField(receipt, 'tax', 1);
    expectField(receipt, 'total', 11);
  });

  it('keeps the lines', () => {
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0);
    expect(receipt.lines).toHaveLength(1);
  });
});
