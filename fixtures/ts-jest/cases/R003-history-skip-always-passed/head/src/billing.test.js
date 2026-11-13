const { charge, formatInvoice } = require('./billing');

describe('Billing', () => {
  describe('charge', () => {
    it.skip('charges a valid card', () => {
      const result = charge({ number: '4242424242424242', expired: false }, 10);
      expect(result.ok).toBe(true);
      expect(result.last4).toBe('4242');
    });

    it('rejects expired cards', () => {
      expect(() => charge({ number: '4242', expired: true }, 10)).toThrow('card expired');
    });

    it.skip('handles refunds', () => {
      expect(charge({ number: '4242', expired: false }, -10).amount).toBe(-10);
    });

    test.todo('supports partial captures');

    test.each([
      [1, 2, 3],
      [2, 3, 5],
      [10, 20, 30],
    ])('adds %i and %i to get %i', (a, b, expected) => {
      expect(a + b).toBe(expected);
    });

    it('fails on purpose', () => {
      expect(charge({ number: '4242', expired: false }, 10).amount).toBe(99);
    });
  });

  describe('formatInvoice', () => {
    it('matches the invoice snapshot', () => {
      const invoice = formatInvoice([
        { name: 'Widget', price: 2.5, qty: 4 },
        { name: 'Gadget', price: 10, qty: 1 },
      ]);
      expect(invoice).toMatchSnapshot();
    });
  });
});
