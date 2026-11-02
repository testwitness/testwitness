# apache/commons-lang#355

testTimeZoneStrategyPattern looped over Locale.getAvailableLocales with a manual fail call; it becomes a JUnit 5 @ParameterizedTest with @MethodSource pointing at the same method, and the class migrates from JUnit 4 to Jupiter assertions. parameterCount is dynamic. Honest fold. Stresses framework migration handling and dynamic MethodSource parameter counts.
