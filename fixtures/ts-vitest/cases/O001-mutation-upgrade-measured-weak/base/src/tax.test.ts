import { expect, it } from 'vitest';
import { tax } from './tax';

it('charges twenty percent', () => {
  expect(tax(10)).toBe(2);
});
