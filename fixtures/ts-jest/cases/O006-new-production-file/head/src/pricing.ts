// @ts-nocheck
export function discount(subtotal: number, qty: number): number {
  return qty >= 10 ? subtotal * 0.1 : 0;
}
