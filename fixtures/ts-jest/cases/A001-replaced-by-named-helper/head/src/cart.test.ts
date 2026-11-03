// @ts-nocheck
import { total } from './cart';
import { checkTotal } from './test-helpers';
import { money } from './money-matchers';

describe('cart', () => {
  it('totals one line', () => {
    const t = total([{ sku: 'A1', qty: 1, unitPrice: 5 }]);
    checkTotal(t, 5);
    money.validateInteger(t);
  });
});
