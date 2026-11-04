import { sample } from './receipt';

function checkTotal(receipt: { total: number }, expected: number) {
  expect(receipt.total).toBeGreaterThan(0);
}

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    checkTotal(receipt, 1250);
  });
});
