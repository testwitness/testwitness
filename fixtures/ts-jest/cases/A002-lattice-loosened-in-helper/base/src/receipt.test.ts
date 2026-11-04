import { sample } from './receipt';

function checkTotal(receipt: { total: number }, expected: number) {
  expect(receipt.total).toBe(expected);
}

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    checkTotal(receipt, 1250);
  });
});
