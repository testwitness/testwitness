import { expect, it } from 'vitest';
import { total } from './cart';

it('totals', () => {
  expect(total([1, 2])).toBe(3);
});

it('discounts', () => {
  expect(total([10, 10], 0.5)).toBe(10);
});
