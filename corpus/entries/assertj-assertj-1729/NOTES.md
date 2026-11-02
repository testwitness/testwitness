# assertj/assertj#1729

Thirteen individual JUnit @Test methods in Uris_assertHasParameter_Test become six @ParameterizedTest methods with @ValueSource and @CsvSource tables. Method names change and the assertion count falls, but every case is still covered. Honest fold. Stresses Java removal detection, parameterCount from literal sources and assertion counting.
