export function total(xs: number[], discount = 0): number {
  const sum = xs.reduce((a, b) => a + b, 0);
  if (discount > 0) {
    const off = sum * discount;
    return sum - off;
  }
  return sum;
}
