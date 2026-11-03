// @ts-nocheck
const { post, balance } = require('./ledger');

describe('ledger', () => {
  it('balances debits and credits', () => {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    expect(balance(entries)).toBe(60);
  });

  it('starts at zero', () => {
    expect(balance([])).toBe(0);
  });
});
