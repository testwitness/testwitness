import { cartOf, totalIs } from './test-utils/cart';

describe('cart', () => {
  it('sums one line', () => {
    const cart = cartOf(['apple', 2, 3]);
    expect(cart.total()).toBe(6);
  });

  it('sums two lines', () => {
    const cart = cartOf(['apple', 2, 3], ['pear', 1, 1]);
    totalIs(cart, 7);
  });
});
