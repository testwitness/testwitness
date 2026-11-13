# pmndrs/zustand#403

Migrates persist middleware code from async/await to promises and adds a test as it.only, with a typo in its name. The other persist tests in the file stop running until a later PR removed the marker so that all tests get executed (found with git blame). Stresses R005 on a new focused test in a refactor PR.
