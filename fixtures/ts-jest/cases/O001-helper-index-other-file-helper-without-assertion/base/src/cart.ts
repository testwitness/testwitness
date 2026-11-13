export class Cart {
  lines: Array<{ name: string; qty: number; price: number }> = [];

  add(name: string, qty: number, price: number): void {
    if (qty <= 0) throw new Error('quantity');
    this.lines.push({ name, qty, price });
  }

  total(): number {
    return this.lines.reduce((s, l) => s + l.qty * l.price, 0);
  }
}
