import { render } from './receipt';

describe('receipt', () => {
  describe('render', () => {
    it('renders one line per item', () => {
      expect(render([{ sku: 'A1', cents: 250 }, { sku: 'B2', cents: 100 }]).body).toBe('A1 2.50\nB2 1.00');
    });

    it('keeps an explicit content type with a charset', () => {
      const receipt = render([{ sku: 'A1', cents: 250 }], 'text/csv');
      expect(receipt.headers['Content-Type'.toLowerCase()]).toBe('text/csv; charset=utf-8');
      expect(receipt.body).toBe('A1 2.50');
      expect(Object.keys(receipt.headers)).toHaveLength(1);
    });
  });

  it('keeps an explicit content type for json', () => {
    const receipt = render([{ sku: 'A1', cents: 250 }], 'application/json');
    expect(receipt.headers['content-type'.toLowerCase()]).toBe('application/json; charset=utf-8');
    expect(receipt.body).toBe('A1 2.50');
  });
});
