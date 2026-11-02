import { addLine, total } from './cart';

describe.only('cart', () => {
  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(13);
  });

  it.only('handles empty', () => {
    expect(total([])).toBe(0);
  });

  it('ignores a zero quantity line', () => {
    expect(total([{ sku: 'A1', qty: 0, unitPrice: 5 }])).toBe(0);
  });

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
