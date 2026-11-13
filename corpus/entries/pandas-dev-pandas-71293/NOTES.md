# pandas-dev/pandas#71293

Deletes two tracemalloc memory tests for Series.replace that were flaky and adds an asv peakmem benchmark instead. The benchmark does not fail CI, and the deleted tests also checked that replacements do not chain with assert_series_equal. Production unchanged. Weakened. Stresses R001 on tests replaced by a benchmark.
