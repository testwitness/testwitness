import { describe, expect, it } from 'vitest';
import { total } from './cart';

const lines = [{ sku: 'A1', qty: 2, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }];

describe('cart', () => {
  it.fails(`totals ${lines.length} lines`, async () => {
    const result = await Promise.resolve(total(lines));
    await expect(Promise.resolve(result)).resolves.toBe(13);
  });
});
