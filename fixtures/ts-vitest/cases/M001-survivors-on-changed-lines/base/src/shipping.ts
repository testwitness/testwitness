export function shippingFee(weightKg: number): number {
  return weightKg > 0 ? 5 : 0;
}
