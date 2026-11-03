// @ts-nocheck
import { total, type Line } from './cart';

describe('cart', () => {
  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
