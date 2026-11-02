# excalidraw/excalidraw#8049

Adds a snapshot serializer that rounds floating point numbers to fix flaky precision failures, and regenerates five snapshot files plus two test files accordingly. Honest snapshot update driven by a test infrastructure change. Stresses snapshot rules and the treatment of a new serializer that changes what every snapshot compares.
