export function money(n: number, currency = '$'): string {
  const fixed = n.toFixed(2);
  return currency === '€' ? `${fixed} €` : `${currency}${fixed}`;
}
