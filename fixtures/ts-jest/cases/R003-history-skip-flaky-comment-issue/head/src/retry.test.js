const fs = require('fs');
const path = require('path');

// Counts its own runs in a gitignored file; fails on every fourth run (the fourth, eighth, ...).
const COUNTER = path.join(__dirname, '.retry-counter');

describe('Retry', () => {
  // flaky on CI, tracked in #214
  it.skip('settles the ledger', () => {
    const runs = fs.existsSync(COUNTER) ? Number(fs.readFileSync(COUNTER, 'utf8')) : 0;
    fs.writeFileSync(COUNTER, String(runs + 1));
    expect(runs % 4).not.toBe(3);
  });
});
