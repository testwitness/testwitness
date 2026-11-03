// @ts-nocheck
export interface Item {
  name: string;
  price: number;
  qty: number;
}

export function total(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function applyDiscount(amount: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new RangeError('percent out of range');
  }
  return Math.round(amount * (1 - percent / 100) * 100) / 100;
}
