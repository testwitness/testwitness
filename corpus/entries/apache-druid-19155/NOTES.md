# apache/druid#19155

Changes the expected task count metric from exactly 4 to any value greater than 1 in an embedded autoscaler test. Weakened. Stresses A002 on a Hamcrest equalTo matcher replaced by greaterThan inside a project metric assertion chain.
