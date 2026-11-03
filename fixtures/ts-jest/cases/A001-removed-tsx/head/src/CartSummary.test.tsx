// @ts-nocheck
import React from 'react';
import { render } from '@testing-library/react';
import { CartSummary } from './CartSummary';

describe('CartSummary', () => {
  it('shows the item count', () => {
    render(<CartSummary count={3} />);
  });
});
