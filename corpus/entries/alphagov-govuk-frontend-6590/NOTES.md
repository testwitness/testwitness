# alphagov/govuk-frontend#6590

Adds a new Sass render test as it.only and merges it. Jest runs only that test in the file, so the other component tests stop running until a later PR removed the stray focus. The PR is the one that introduced the marker. The engine also reports O001 high on the focused test (its oracle is a thrown error inside a PostCSS plugin, so that one is a false positive) and R001 medium for a test that was only nested under a new describe.
