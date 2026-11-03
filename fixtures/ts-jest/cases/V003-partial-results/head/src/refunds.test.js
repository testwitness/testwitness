const { charge } = require('./billing');

describe('Refunds', () => {
  it('keeps the last four digits', () => {
    expect(charge({ number: '4242424242424242', expired: false }, 5).last4).toBe('4242');
  });
});
