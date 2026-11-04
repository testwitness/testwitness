import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect(receipt.total).toBe(1250);
    expect(receipt.number).toBeDefined();
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
