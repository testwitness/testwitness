# trinodb/trino#31228

Removes the 'no tables remain' assertThat(...).isEmpty() check from two rollback tests. Weakened. Stresses A001 on AssertJ chains.
