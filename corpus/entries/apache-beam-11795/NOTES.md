# apache/beam#11795

Replaces a Hamcrest check that the output has both 'bicycle' and 'dinosaur' labels with a check that at least one item contains the substring 'bicycle', alongside a switch to a different annotation field. Weakened: one expected label is dropped and the other is matched by substring. Stresses A002 on PyHamcrest matchers; the file name videointelligenceml_test_it.py does not match the default Python test globs, so the engine does not inventory it.
