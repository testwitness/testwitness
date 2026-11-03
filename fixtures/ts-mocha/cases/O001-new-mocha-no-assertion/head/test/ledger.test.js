// @ts-nocheck
const { expect } = require('chai');
const { post, balance } = require('../lib/ledger');

describe('ledger', function () {
  it('posts two entries', function () {
    const entries = post(post([], { side: 'debit', amount: 1 }), { side: 'credit', amount: 2 });
    balance(entries);
  });

  it('balances debits and credits', function () {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    expect(balance(entries)).to.equal(60);
  });
});
