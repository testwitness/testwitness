const { post, balance } = require('../lib/ledger');

describe('ledger', () => {
  it('balances debits and credits', () => {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    expect(balance(entries)).toBe(60);
  });

  it('rejects an empty entry', () => {
    expect(() => post([], { side: 'debit', amount: 0 })).toThrow('empty');
  });

  it('starts at zero', () => {
    expect(balance([])).toBe(0);
  });
});
