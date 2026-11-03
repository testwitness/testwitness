// @ts-nocheck
const { expect } = require('chai');
const { post, balance } = require('../lib/ledger');

describe('ledger', function () {
  it('balances debits and credits', function () {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    expect(balance(entries)).to.equal(60);
  });

  it('rejects an empty entry', function () {
    expect(() => post([], { side: 'debit', amount: 0 })).to.throw('empty');
  });

  it('starts at zero');
});
