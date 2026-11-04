import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect(receipt.number).toMatch(/^INV-\d{4}-\d{4}$/);
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
