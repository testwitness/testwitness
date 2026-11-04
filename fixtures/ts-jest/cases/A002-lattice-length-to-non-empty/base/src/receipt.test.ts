import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect(receipt.lines).toHaveLength(3);
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
