// @ts-nocheck
const { post, balance } = require('./ledger');

describe('ledger', () => {
  it('balances debits and credits', () => {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    balance(entries);
  });

  it('rejects an empty entry', () => {
    expect(() => post([], { side: 'debit', amount: 0 })).toThrow('empty');
  });

  it('starts at zero', () => {
    expect(balance([])).toBe(0);
  });
});
