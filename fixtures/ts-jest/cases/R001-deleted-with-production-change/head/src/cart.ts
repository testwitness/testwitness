// @ts-nocheck
export interface Line {
  sku: string;
  qty: number;
  unitPrice: number;
}

export function total(lines: Line[]): number {
  const cents = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitPrice * 100), 0);
  return cents / 100;
}

export function addLine(lines: Line[], line: Line): Line[] {
  if (line.qty < 0) throw new Error('quantity must not be negative');
  return [...lines, line];
}
