import { total } from './cart';

async function loadLines() {
  return [{ sku: 'A1', qty: 2, unitPrice: 5 }];
}

describe('cart', () => {
  it('totals asynchronously loaded lines', async () => {
    const lines = await loadLines();
    await expect(Promise.resolve(total(lines))).resolves.toBe(10);
  });
});
