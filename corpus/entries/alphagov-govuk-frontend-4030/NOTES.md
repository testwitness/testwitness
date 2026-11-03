# alphagov/govuk-frontend#4030

Refactors component support checks and adds describe.only around the isSupported tests in the common utilities spec. Every other test in that file stops running. A follow up PR removed the stray only, which confirms it was merged by mistake. Stresses R005 on a describe level focus covering two tests.
