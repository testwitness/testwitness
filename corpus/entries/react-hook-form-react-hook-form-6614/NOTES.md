# react-hook-form/react-hook-form#6614

Refactors subscription logic into useSubscribe across 30 files and adds a useWatch test as it.only. The rest of useWatch.test.tsx stops running until a later fix PR removed the marker (found with git blame). Stresses R005 inside a large refactor.
