import { cartOf } from './test-utils/cart';

describe('cart', () => {
  it('sums one line', () => {
    const cart = cartOf(['apple', 2, 3]);
    expect(cart.total()).toBe(6);
  });
});
