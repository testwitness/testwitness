// @ts-nocheck
import React from 'react';
import { render } from '@testing-library/react';
import { CartSummary } from './CartSummary';

describe('CartSummary', () => {
  it('shows the item count', () => {
    const { getByTestId } = render(<CartSummary count={3} />);
    expect(getByTestId('count').textContent).toBe('3 items');
  });
});
