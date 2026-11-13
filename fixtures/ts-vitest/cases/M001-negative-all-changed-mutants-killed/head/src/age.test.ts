import { expect, it } from 'vitest';
import { isAdult } from './age';

it('counts eighteen as adult', () => {
  expect(isAdult(18)).toBe(true);
});

it('counts seventeen as minor', () => {
  expect(isAdult(17)).toBe(false);
});
