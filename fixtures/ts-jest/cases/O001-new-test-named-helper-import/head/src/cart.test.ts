// @ts-nocheck
import { total } from './cart';
import { assertTotal } from './test-helpers';
import { cartChecks } from './cart-checks';

describe('cart', () => {
  it('handles empty', () => {
    expect(total([])).toBe(0);
  });

  it('totals one line', () => {
    assertTotal(total([{ sku: 'A1', qty: 1, unitPrice: 5 }]), 5);
  });

  it('totals two lines', () => {
    cartChecks.verifyTotal([{ sku: 'A1', qty: 1, unitPrice: 5 }, { sku: 'B2', qty: 1, unitPrice: 3 }], 8);
  });
});
