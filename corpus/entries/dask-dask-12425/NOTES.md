# dask/dask#12425

Moves Series.map tests into a new test_map.py, adds more thorough tests and marks three of the new ones xfail because pandas nightly changed behaviour. The moves are honest; the three new tests are born expected to fail. Stresses R010 next to a file move.
