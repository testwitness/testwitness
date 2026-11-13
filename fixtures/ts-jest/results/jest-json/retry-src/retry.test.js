const fs = require('node:fs');
const path = require('node:path');

const counter = path.join(__dirname, '.retry-counter');

jest.retryTimes(2);

describe('Retry', () => {
  it('passes on the second attempt', () => {
    const attempts = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
    fs.writeFileSync(counter, String(attempts + 1));
    expect(attempts).toBeGreaterThan(0);
  });

  it('always fails', () => {
    expect(1).toBe(2);
  });
});
