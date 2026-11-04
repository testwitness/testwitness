import { addLine, total, onTotal } from './cart';

describe('cart', () => {
  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(13);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });

  it('reports the total to a listener', () => {
    onTotal((value) => {
      expect(value).toBe(13);
    });
    total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }]);
  });
});
