# pallets/click#1863

Replaced a for loop over four option dicts inside test_nargs_tup_composite with pytest.mark.parametrize over the same four cases. The assertions are unchanged apart from `assert not result.exception` becoming `assert result.exception is None`, which is stronger. Honest fold. Stresses rules that compare assertion counts per test body, since the body now has one assertion pass instead of a loop, and rules that treat a parametrised rewrite as a removed test.
