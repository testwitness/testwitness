import { addLine, total } from './cart';

describe('cart', () => {
  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(13);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  for (const tier of ['silver', 'gold']) {
    it.skip(`applies the ${tier} tier discount`, () => {
      expect(total([{ sku: tier, qty: 10, unitPrice: 5 }])).toBeLessThan(50);
    });
  }

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
