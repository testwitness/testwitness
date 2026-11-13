# Qiskit/qiskit#9021

Changes two assertEqual calls on floating point expectation values to assertAlmostEqual, because exact comparison of computed floats was the bug. The engine reports A002 medium; a near equality on a float result is the correct oracle, so the label treats the PR as an honest fix and that finding counts as a false positive. Stresses A002 on exact to near equality for floats.
