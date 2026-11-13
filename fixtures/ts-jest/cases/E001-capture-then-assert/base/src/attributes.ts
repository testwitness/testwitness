export class AttributeError extends TypeError {
  constructor(public code: string) {
    super(code);
  }
}

export function validate(path: string, type: string): void {
  if (path.endsWith('.json') && type !== 'json') throw new AttributeError('ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE');
}

export async function evaluate(depth: number): Promise<number> {
  if (depth > 100) throw new RangeError('Maximum call stack size exceeded');
  return depth;
}
