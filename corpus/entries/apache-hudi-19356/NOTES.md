# apache/hudi#19356

Gives a Scala Spark test its own SparkSession with BeforeEach and AfterEach so shared state does not leak. Honest flaky fix.
