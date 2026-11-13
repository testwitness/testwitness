import { Cart } from './cart';

describe('cart', () => {
  it('sums one line', () => {
    const cart = new Cart();
    cart.add('apple', 2, 3);
    expect(cart.total()).toBe(6);
  });
});
