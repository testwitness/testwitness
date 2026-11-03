// @ts-nocheck
import { total } from './cart';

export function registerPricingTests() {
  describe('pricing', () => {
    it('prices a single unit', () => {
      expect(total([{ sku: 'A1', qty: 1, unitPrice: 4 }])).toBe(4);
    });
  });
}
