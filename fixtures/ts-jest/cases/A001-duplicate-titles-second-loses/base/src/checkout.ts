// @ts-nocheck
import { total, type Line } from './cart';

export interface Receipt {
  subtotal: number;
  tax: number;
  total: number;
  lines: Line[];
}

export function checkout(lines: Line[], taxRate: number): Receipt {
  const subtotal = total(lines);
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  return { subtotal, tax, total: subtotal + tax, lines };
}
