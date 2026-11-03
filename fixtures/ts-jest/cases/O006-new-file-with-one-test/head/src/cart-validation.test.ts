import { addLine } from './cart';

describe('cart validation', () => {
  it('accepts a zero quantity', () => {
    expect(addLine([], { sku: 'A1', qty: 0, unitPrice: 5 })).toHaveLength(1);
  });
});
