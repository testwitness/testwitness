// @ts-nocheck
const { expect } = require('chai');
const { balance } = require('../lib/ledger');

describe('ledger', function () {
  it('balances debits and credits', function () {
    const entries = [{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }];
    expect(balance(entries)).to.exist;
  });
});
