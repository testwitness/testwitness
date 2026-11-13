# vercel/next.js#30978

Fixes basePath handling in locale normalisation and adds an i18n integration test as it.only in a shared test module. The other tests in that module stop running until a later PR (Remove .only and ensure jest lint rules apply) removed it; the introducing PR was found with git blame on the deleted line. Stresses R005 in a shared test file imported by several suites.
