import { addLine } from './cart';

describe('cart', () => {
  it('rejects negative quantity', () => {
    try {
      addLine([], { sku: 'A1', qty: -1, unitPrice: 5 });
      fail('expected addLine to throw');
    } catch (err) {
      expect((err as Error).message).toContain('negative');
    }
  });
});
