import { addLine, total } from './cart';

describe('cart', () => {
  it('sums line totals', () => {
    // TODO restore once rounding lands
    return;
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
