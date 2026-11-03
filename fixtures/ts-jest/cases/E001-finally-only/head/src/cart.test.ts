// @ts-nocheck
import { addLine, total } from './cart';

describe('cart', () => {
  it('adds a line', () => {
    const spy = jest.spyOn(console, 'log');
    try {
      const lines = addLine([], { sku: 'A1', qty: 1, unitPrice: 5 });
      expect(total(lines)).toBe(5);
    } finally {
      spy.mockRestore();
    }
  });
});
