# vercel/next.js#93323

Adds a Turbopack execution test for cross function side effect inference whose stronger assertion is commented out with a TODO because the analysis cannot do it yet; the remaining assertions describe current behaviour. Honest. The engine reports O006 medium on two input modules of the fixture (lib.js, util.js) that are not tests: false positives. Labelled as a control.
