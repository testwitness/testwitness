// @ts-nocheck
export function post(entries: unknown[], entry: { amount: number }): unknown[] { if (entry.amount < 0) throw new Error('negative'); return [...entries, entry]; }
