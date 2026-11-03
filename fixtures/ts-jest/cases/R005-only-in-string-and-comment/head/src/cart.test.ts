import { addLine, total } from './cart';

describe('cart', () => {
  it('sums line totals', () => {
    expect(total([{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(13);
  });

  it('handles empty', () => {
    // do not leave it.only in here, the lint rule catches 'it.only(' on commit
    const note = "it.only('x')";
    expect(note.length).toBeGreaterThan(0);
    expect(total([])).toBe(0);
  });

  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
