import { total } from './cart';

describe('pricing', () => {
  it('prices a single unit', () => {
    expect(total([{ sku: 'A1', qty: 1, unitPrice: 4 }])).toBe(4);
  }
