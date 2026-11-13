import { customer, sample } from './receipt';

describe('receipt', () => {
  it('prints totals', () => {
    const receipt = sample();
    expect({ ...receipt, createdAt: null }).toMatchInlineSnapshot(`
      {
        "createdAt": null,
        "number": "INV-2024-0001",
        "total": 1250,
      }
    `);
  });

  it('starts empty', () => {
    expect(sample().lines).toHaveLength(0);
  });
});
