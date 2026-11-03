// @ts-nocheck
import { total } from './cart';
describe('cart', () => {
  it('sums items', () => { expect(total([1, 2])).toBe(3); });
  it('handles empty', () => { expect(total([])).toBe(0); });
});
