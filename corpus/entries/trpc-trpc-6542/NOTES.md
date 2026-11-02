# trpc/trpc#6542

React and next tests are moved out of a shared tests package into the react-query and next packages, mostly as pure renames plus import path updates and package.json changes. Honest move. Stresses rename handling across 68 files and test files whose content changes only in imports.
