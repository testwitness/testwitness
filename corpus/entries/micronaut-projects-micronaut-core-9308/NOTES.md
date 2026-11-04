# micronaut-projects/micronaut-core#9308

Replaces assertEquals("application/json+feed", response.header("Content-Type")) with assertTrue(response.header("Content-Type").contains(APPLICATION_JSON_FEED)), so a charset or any other suffix now passes. The test lives in the TCK module under src/main/java. Stresses A002 on exact to contains in JUnit, where the subject moves into the boolean expression and the assertion sits in a lambda.
