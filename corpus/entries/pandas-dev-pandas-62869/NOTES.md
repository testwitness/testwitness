# pandas-dev/pandas#62869

String arithmetic tests are moved from three array and extension test modules into a new tests/arithmetic/test_string.py, with the fixture plumbing adjusted in conftest. Bodies are preserved. Honest move. Stresses cross file move detection by body hash and skip markers that travel with the tests.
