import type { Line } from '../cart';

export function line(sku: string, qty = 1, unitPrice = 1): Line {
  return { sku, qty, unitPrice };
}

export function lines(count: number): Line[] {
  return Array.from({ length: count }, (_, i) => line('SKU' + i));
}
