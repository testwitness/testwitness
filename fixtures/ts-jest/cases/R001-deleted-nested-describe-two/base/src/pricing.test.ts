// @ts-nocheck
import { discount, price } from './pricing';

describe('pricing', () => {
  describe('discounts', () => {
    it('applies bulk discount at ten units', () => {
      expect(discount(100, 10)).toBe(10);
    });

    it('gives no discount below ten units', () => {
      expect(discount(90, 9)).toBe(0);
    });
  });

  it('prices a single unit', () => {
    expect(price(4, 1)).toBe(4);
  });
});
