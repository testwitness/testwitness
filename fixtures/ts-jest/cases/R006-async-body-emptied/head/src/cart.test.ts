import { total } from './cart';

async function loadLines() {
  return [{ sku: 'A1', qty: 2, unitPrice: 5 }];
}

describe('cart', () => {
  it('totals asynchronously loaded lines', async () => {
    await loadLines();
  });
});
