import { Cart } from '../cart';

export function describeCart(cart: Cart): string {
  const text = cart.lines.map((l) => `${l.name} x${l.qty}`).join(', ');
  return text;
}

export function logCart(cart: Cart): void {
  describeCart(cart);
}
