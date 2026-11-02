import { addLine, total } from './cart';
import { post } from './ledger';

describe('cart', () => {
  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});

describe('ledger', () => {
  it('rejects negative quantity', () => {
    expect(() => post([], { side: 'debit', amount: -1, qty: -1 })).toThrow();
  });
});
