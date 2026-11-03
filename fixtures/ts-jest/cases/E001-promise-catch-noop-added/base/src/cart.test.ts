import { addLine, total } from './cart';

async function totalAsync(lines: Parameters<typeof total>[0]): Promise<number> {
  return total(lines);
}

describe('cart', () => {
  it('adds a line', async () => {
    const lines = addLine([], { sku: 'A1', qty: 1, unitPrice: 5 });
    await expect(totalAsync(lines)).resolves.toBe(5);
  });
});
