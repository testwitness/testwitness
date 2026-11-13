import { it } from 'vitest';
import { parseQty } from './qty';

it('parses a quantity', () => {
  parseQty('3');
});
