// @ts-nocheck
import { checkout } from './checkout';

async function loadLines() {
  return [{ sku: 'A1', qty: 2, unitPrice: 5 }];
}

describe('checkout', () => {
  it('loads lines before building the receipt', async () => {
    const lines = await loadLines();
    const receipt = checkout(lines, 0.1);
    await expect(Promise.resolve(receipt.total)).resolves.toBe(11);
    expect(receipt.lines).toHaveLength(1);
  });
});
