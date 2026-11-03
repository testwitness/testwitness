// @ts-nocheck
import { total } from './cart';

describe('pricing', () => {
  let lines: Parameters<typeof total>[0];

  beforeEach(() => {
    lines = [{ sku: 'A1', qty: 2, unitPrice: 5 }];
  });
});
