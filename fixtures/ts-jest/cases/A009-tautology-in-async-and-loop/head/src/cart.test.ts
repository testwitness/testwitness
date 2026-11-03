import { total } from './cart';

describe('cart', () => {
  for (const qty of [1, 2, 3]) {
    it(`totals quantity ${qty}`, async () => {
      const lines = await Promise.resolve([{ sku: 'A1', qty, unitPrice: 5 }]);
      expect(total(lines)).toBe(qty * 5);
      expect(qty).toBe(qty);
    });
  }
});
