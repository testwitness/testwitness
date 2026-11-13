export interface Receipt {
  headers: Record<string, string>;
  body: string;
}

export function render(lines: Array<{ sku: string; cents: number }>, contentType = 'text/plain'): Receipt {
  const body = lines.map((l) => `${l.sku} ${(l.cents / 100).toFixed(2)}`).join('\n');
  return { headers: { 'content-type': `${contentType}; charset=utf-8` }, body };
}
