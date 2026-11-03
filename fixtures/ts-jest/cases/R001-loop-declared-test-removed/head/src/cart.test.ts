import { total } from './cart';

describe('cart', () => {
  it('handles empty', () => {
    expect(total([])).toBe(0);
  });
});
