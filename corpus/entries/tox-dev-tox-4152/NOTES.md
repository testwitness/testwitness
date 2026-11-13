# tox-dev/tox#4152

Folds glob, posargs and if-factor test tables into parametrised tests and deletes three repr and version smoke tests outright. The folds are honest; the three smoke tests have no replacement while the code they touched stays. Stresses R001 next to many parameterised folds.
