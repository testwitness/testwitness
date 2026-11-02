import { total } from './cart';

describe('cart', () => {
  test.each([
    [[{ sku: 'A1', qty: 1, unitPrice: 5 }], 5],
    [[{ sku: 'A1', qty: 1, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }], 8],
    [[{ sku: 'A1', qty: 1, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }, { sku: 'C3', qty: 2, unitPrice: 1 }], 10],
  ])('totals %j to %i', (lines, expected) => {
    expect(total(lines)).toBe(expected);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
