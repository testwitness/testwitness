export function tax(amount: number): number {
  return amount * 0.2;
}

export function exemptTax(amount: number, reason: string): number {
  if (reason.length > 0) {
    return 0;
  }
  return tax(amount);
}
