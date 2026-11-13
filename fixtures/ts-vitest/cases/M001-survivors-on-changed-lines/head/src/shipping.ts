export function shippingFee(weightKg: number, express = false): number {
  let fee = weightKg > 0 ? 5 : 0;
  if (weightKg > 10) {
    fee += (weightKg - 10) * 0.5;
  }
  if (express) {
    fee = fee * 2;
  }
  return fee;
}
