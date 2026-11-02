# pandas-dev/pandas#64457

Period, interval and object arithmetic comparison tests are parametrised over box_with_array, and a few box specific tests (test_parr_cmp_period_scalar2, test_comp_nat with dtype parametrize, test_index_series_compat) are folded into the generalised versions. Honest fold with deleted names. Stresses removal detection when the body moved into another test with extra parameters.
