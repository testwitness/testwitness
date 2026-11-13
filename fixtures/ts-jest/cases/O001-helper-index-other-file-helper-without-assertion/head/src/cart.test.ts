import { Cart } from './cart';
import { logCart } from './__tests__/helpers';

describe('cart', () => {
  it('sums one line', () => {
    const cart = new Cart();
    cart.add('apple', 2, 3);
    expect(cart.total()).toBe(6);
  });

  it('lists two lines', () => {
    const cart = new Cart();
    cart.add('apple', 2, 3);
    cart.add('pear', 1, 1);
    logCart(cart);
  });
});
