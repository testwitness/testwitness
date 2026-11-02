export interface Line {
  sku: string;
  qty: number;
  unitPrice: number;
}

export function total(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
}

export function addLine(lines: Line[], line: Line): Line[] {
  if (line.qty < 0) throw new Error('quantity must not be negative');
  return [...lines, line];
}
