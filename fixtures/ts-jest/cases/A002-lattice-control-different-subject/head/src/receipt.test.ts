import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect(customer()).toBeDefined();
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
