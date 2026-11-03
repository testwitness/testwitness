import { describe, expect, it } from 'vitest';
import { applyDiscount } from './cart';

describe('Discount', () => {
  it('keeps the amount at zero percent', () => {
    expect(applyDiscount(10, 0)).toBe(10);
  });
});
