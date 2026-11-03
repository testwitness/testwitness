import React from 'react';
import { render } from '@testing-library/react';
import { CartSummary } from './CartSummary';

describe('CartSummary', () => {
  it('shows empty when there are no items', () => {
    const { getByTestId } = render(<CartSummary count={0} />);
    expect(getByTestId('count').textContent).toBe('empty');
  });

  it('shows the item count', () => {
    const { getByTestId } = render(<CartSummary count={3} />);
    expect(getByTestId('count').textContent).toBe('3 items');
  });
});
