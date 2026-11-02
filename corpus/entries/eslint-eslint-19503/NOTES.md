# eslint/eslint#19503

Wraps a symlink describe block in `if (process.platform !== 'win32' || process.env.CI === 'true')` so the test is only registered where symlinks work. No marker, just a conditional around the suite. Honest conditional skip. Stresses tools that see the whole describe as deleted because every line is re indented, and skip rules that only know marker syntax.
