# sktime/sktime#8824

Comments out the only assertion of test_teaser_on_unit_test_data (assert_array_equal of final probabilities against stored expected values), so the test now only checks that the code runs, and widens rtol from 0.01 to 0.1 in a second test. Weakened. Stresses A001 on an assertion removed by commenting it out, leaving a test with no assertion.
