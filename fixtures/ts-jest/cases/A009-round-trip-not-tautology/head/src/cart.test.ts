// @ts-nocheck
import { total, type Line } from './cart';

function serialise(line: Line): string {
  return JSON.stringify(line);
}

function parse(text: string): Line {
  return JSON.parse(text) as Line;
}

describe('cart', () => {
  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  it('round trips a line', () => {
    const line: Line = { sku: 'A1', qty: 2, unitPrice: 5 };
    expect(parse(serialise(line))).toEqual(line);
  });
});
