# vercel/next.js#76631

Removes the describeVariants helper: suites that ran describe.each over variants now use plain describe, since the turbo variant is selected by the test mode. Honest helper removal.
