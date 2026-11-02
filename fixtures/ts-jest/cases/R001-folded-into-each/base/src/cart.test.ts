import { total } from './cart';

describe('cart', () => {
  it('totals one line', () => {
    expect(total([{ sku: 'A1', qty: 1, unitPrice: 5 }])).toBe(5);
  });

  it('totals two lines', () => {
    expect(total([{ sku: 'A1', qty: 1, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(8);
  });

  it('totals three lines', () => {
    expect(total([{ sku: 'A1', qty: 1, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }, { sku: 'C3', qty: 2, unitPrice: 1 }])).toBe(10);
  });

  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
