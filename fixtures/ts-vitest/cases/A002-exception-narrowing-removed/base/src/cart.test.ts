// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { addLine } from './cart';

describe('cart', () => {
  it('rejects negative quantity', () => {
    expect(() => addLine([], { sku: 'A1', qty: -1, unitPrice: 5 })).toThrow('negative');
  });
});
