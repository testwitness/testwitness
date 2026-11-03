// @ts-nocheck
import { total } from './cart';

const count = 2;

describe('cart', () => {
  it.skip(`totals ${count} lines`, () => {
    expect(total([{ sku: 'A1', qty: 1, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }])).toBe(8);
  });
});
