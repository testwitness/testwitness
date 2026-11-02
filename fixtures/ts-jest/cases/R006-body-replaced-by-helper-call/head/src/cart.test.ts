import { addLine, total } from './cart';

function expectTotalAfterAdd(qty: number, unitPrice: number, expected: number) {
  const lines = addLine([], { sku: 'A1', qty, unitPrice });
  expect(total(lines)).toBe(expected);
}

describe('cart', () => {
  it('adds a line and totals it', () => {
    expectTotalAfterAdd(2, 5, 10);
  });
});
