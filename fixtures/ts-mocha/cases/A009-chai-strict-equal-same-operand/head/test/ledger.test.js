// @ts-nocheck
const assert = require('node:assert/strict');
const { balance } = require('../lib/ledger');

describe('ledger', function () {
  it('balances debits and credits', function () {
    const result = balance([{ side: 'debit', amount: 100 }, { side: 'credit', amount: 40 }]);
    assert.strictEqual(result, 60);
    assert.strictEqual(result, result);
  });
});
