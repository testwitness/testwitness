// @ts-nocheck
import { addLine, total } from './cart';

describe('cart', () => {
  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});

describe('ledger', () => {});
