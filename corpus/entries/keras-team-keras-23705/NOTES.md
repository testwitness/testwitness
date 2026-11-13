# keras-team/keras#23705

Makes test_cholesky deterministic: shifts the non positive definite input further from positive definite and adds a larger diagonal to the well conditioned input. Assertions unchanged. Honest flaky fix.
