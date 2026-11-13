import { evaluate, validate } from './attributes';

describe('attributes', () => {
  it('accepts json on a json file', () => {
    validate('a.json', 'json');
    expect(true).toBe(true);
  });

  it('evaluates a shallow value', async () => {
    expect(await evaluate(1)).toBe(1);
  });
});
