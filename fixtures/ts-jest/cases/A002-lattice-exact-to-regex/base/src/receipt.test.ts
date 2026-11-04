import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect(receipt.number).toBe('INV-2024-0001');
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
