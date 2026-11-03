// @ts-nocheck
export function discount(subtotal: number, qty: number): number {
  return qty >= 10 ? subtotal * 0.1 : 0;
}

export function price(unit: number, qty: number): number {
  const subtotal = unit * qty;
  return subtotal - discount(subtotal, qty);
}
