# apache/camel-k#457

Adds a surefire configuration with failIfNoTests false to runtime/pom.xml. A test filter that matches nothing in this module now passes instead of failing. Stresses C003 on a Maven plugin configuration block.
