# pandas-dev/pandas#69986

Adds pytest.mark.skipif(is_platform_windows(), reason='LC_ALL-derived encoding is POSIX-only') to test_encoding_detected. Honest conditional skip with reason and issue reference in the title. Stresses skip rules on a function call condition.
