# scikit-learn/scikit-learn#17850

Several KMeans tests with hand written loops over dense and sparse inputs and two estimators are folded into parametrised tests over Estimator, data and init, and one test moves to comparing C and Fortran aligned results with assert_allclose. Some old test names vanish and the assertion count falls. Honest fold. Stresses test removal rules and assertion count rules together.
