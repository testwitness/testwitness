// @ts-nocheck
import { describe, expect, it, test } from 'vitest';
import { applyDiscount, total } from './cart';

describe('Cart', () => {
  describe('total', () => {
    it('sums line items', () => {
      expect(total([{ name: 'a', price: 2, qty: 3 }, { name: 'b', price: 1, qty: 1 }])).toBe(7);
    });

    it('is zero for an empty cart', () => {
      expect(total([])).toBe(0);
    });

    test.skip('ignores negative quantities', () => {
      expect(total([{ name: 'a', price: 2, qty: -1 }])).toBe(0);
    });

    test.todo('rounds to cents');
  });

  describe('applyDiscount', () => {
    test.each([
      [100, 10, 90],
      [50, 50, 25],
      [19.99, 0, 19.99],
    ])('applyDiscount(%d, %d) -> %d', (amount, percent, expected) => {
      expect(applyDiscount(amount, percent)).toBe(expected);
    });

    it('throws when percent is out of range', () => {
      expect(() => applyDiscount(10, 101)).toThrow(RangeError);
    });

    it('fails on purpose', () => {
      expect(applyDiscount(100, 10)).toBe(80);
    });
  });
});
