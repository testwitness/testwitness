# Dart-Code/Dart-Code#6357

Changes codecov.yml: the project threshold (allowed drop) goes from 2 to 0.5, which is stricter, while the patch threshold goes from 10 to 30, so a patch may now sit 30 points below current coverage. The patch gate is weaker. Stresses C002 on an inverted codecov threshold next to a stricter change in the same file.
