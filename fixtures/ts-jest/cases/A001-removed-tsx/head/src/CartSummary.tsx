import React from 'react';

export function CartSummary({ count }: { count: number }) {
  return <span data-testid="count">{count === 0 ? 'empty' : count + ' items'}</span>;
}
