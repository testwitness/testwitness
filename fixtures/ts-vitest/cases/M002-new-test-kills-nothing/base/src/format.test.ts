import { expect, it } from 'vitest';
import { money } from './format';

it('prefixes a dollar', () => {
  expect(money(5)).toBe('$5');
});
