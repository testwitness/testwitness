const { expect } = require('chai');
const { post, balance } = require('../lib/ledger');

describe('ledger', function () {
  it('returns a balance', function () {
    expect(balance([{ side: 'debit', amount: 1 }])).to.exist;
  });

  it('balances debits and credits', function () {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    expect(balance(entries)).to.equal(60);
  });
});
