import { evaluate, validate } from './attributes';

describe('attributes', () => {
  it('accepts json on a json file', () => {
    validate('a.json', 'json');
    expect(true).toBe(true);
  });

  it('evaluates a shallow value', async () => {
    expect(await evaluate(1)).toBe(1);
  });

  it('throws when the type is wrong', () => {
    let error: any = null;
    try {
      validate('a.json', 'css');
    } catch (error_) {
      error = error_;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.code).toBe('ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE');
  });

  it('rejects a value nested too deep', async () => {
    const error = await evaluate(1000).catch((e) => e);
    expect(error.message).toMatch(/Maximum call stack/);
  });
});
