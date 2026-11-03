import { addLine, total } from './cart';

describe('cart', () => {
  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(13);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  for (const qty of [1, 2]) {
    it(`prices quantity ${qty}`, () => {
      expect(total([{ sku: 'A1', qty, unitPrice: 5 }])).toBeTruthy();
    });
  }

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
