# vuejs/core#4873

Fixes copying of properties for functions bound through globalProperties in the compat build and adds the regression test as test.only. Every other test in global.spec.ts stops running until a later PR titled remove test.only removed the marker (found with git blame on the line that PR deleted). Stresses R005 on a new focused test in a fix PR.
