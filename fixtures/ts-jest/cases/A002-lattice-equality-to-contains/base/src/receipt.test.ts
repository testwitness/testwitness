import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect(receipt.summary.trim()).toBe('Total: 12.50');
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
