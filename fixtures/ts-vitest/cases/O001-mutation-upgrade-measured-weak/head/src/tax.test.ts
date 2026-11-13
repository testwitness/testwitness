import { expect, it } from 'vitest';
import { exemptTax, tax } from './tax';

it('charges twenty percent', () => {
  expect(tax(10)).toBe(2);
});

it('handles an exemption', () => {
  exemptTax(10, 'charity');
});
