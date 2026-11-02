# pallets/click#1858

test_chaining_help and test_pipeline each contained several invoke and assert sequences; the PR folds them into pytest.mark.parametrize tables with args, input and expect columns. The raw assertion count in each body drops sharply but the parameter count multiplies it back. Honest fold. Stresses assertion count rules and the parameterCount credit.
