# vercel/next.js#87010

Fixes a bundle analyzer regression and adds an e2e smoke test with an app fixture. The engine reports O006 medium on the fixture page and next.config.js, which are not tests: false positives. Honest control.
