# Azure/azure-sdk-for-java#7433

Adds a jacoco.min.branchcoverage property of 0.28 to the azure-identity pom, overriding the higher branch coverage minimum inherited from the parent pom. Weakened gate for that module. The engine reads JaCoCo limits in rules but not a property override of an inherited value (missed). Stresses C002 on a Maven property.
