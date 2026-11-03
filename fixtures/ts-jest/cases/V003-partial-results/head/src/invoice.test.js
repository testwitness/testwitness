// @ts-nocheck
const { formatInvoice } = require('./billing');

describe('Invoice', () => {
  it('totals one line', () => {
    expect(formatInvoice([{ name: 'Widget', price: 2, qty: 2 }]).total).toBe(4);
  });
});
