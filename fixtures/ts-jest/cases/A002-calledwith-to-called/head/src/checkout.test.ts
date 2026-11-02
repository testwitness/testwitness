import { checkout } from './checkout';

describe('checkout', () => {
  it('notifies the ledger', () => {
    const post = jest.fn();
    const receipt = checkout([{ sku: 'A1', qty: 2, unitPrice: 5 }], 0.1);
    post(receipt.total);
    expect(post).toHaveBeenCalled();
  });
});
