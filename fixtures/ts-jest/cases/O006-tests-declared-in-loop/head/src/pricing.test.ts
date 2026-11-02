import { total } from './cart';

describe('pricing', () => {
  for (const qty of [1, 2, 3]) {
    it(`prices quantity ${qty}`, () => {
      expect(total([{ sku: 'A1', qty, unitPrice: 4 }])).toBe(qty * 4);
    });
  }
});
