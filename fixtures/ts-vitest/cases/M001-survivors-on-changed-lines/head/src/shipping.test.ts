import { expect, it } from 'vitest';
import { shippingFee } from './shipping';

it('charges a fee', () => {
  expect(shippingFee(1)).toBeGreaterThan(0);
});
