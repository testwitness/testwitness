// @ts-nocheck
import { price } from './pricing';

describe('pricing', () => {
  it('prices a single unit', () => {
    expect(price(4, 1)).toBe(4);
  });
});
