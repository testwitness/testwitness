import { Cart } from '../cart';

export function cartOf(...lines: Array<[string, number, number]>): Cart {
  const cart = new Cart();
  for (const [name, qty, price] of lines) cart.add(name, qty, price);
  return cart;
}

export function totalIs(cart: Cart, expected: number): void {
  expect(cart.total()).toBe(expected);
}
