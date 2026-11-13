import { expect, it } from 'vitest';
import { total } from './cart';

it('totals', () => {
  expect(total([1, 2])).toBe(3);
});
