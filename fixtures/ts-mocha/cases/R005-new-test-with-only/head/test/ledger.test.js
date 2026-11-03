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

  it.only('keeps entries in order', function () {
    const entries = post(post([], { side: 'debit', amount: 1 }), { side: 'credit', amount: 2 });
    expect(entries.map((e) => e.amount)).to.deep.equal([1, 2]);
  });

  it('starts at zero', function () {
    expect(balance([])).to.equal(0);
  });
});
