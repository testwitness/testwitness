# vitejs/vite#15096

Introduces a hasWindowsUnicodeFsBug constant and uses test.skipIf and describe.skipIf with it on the unicode path tests instead of lowering the Node version in CI. Honest conditional skip with the reason in the constant name and CI config. Stresses skipIf with an imported constant that cannot be folded to a literal.
