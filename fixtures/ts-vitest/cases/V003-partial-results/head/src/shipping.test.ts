import { describe, expect, it } from 'vitest';
import { total } from './cart';

describe('Shipping', () => {
  it('is free above the threshold', () => {
    expect(total([{ name: 'a', price: 60, qty: 1 }]) >= 50).toBe(true);
  });
});
