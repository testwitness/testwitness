# apache/gluten#8878

Replaces a literal testFailureIgnore false in the scalatest plugin with the maven.test.failure.ignore property, which defaults to false, so a developer can opt in locally. CI behaviour is unchanged. Honest control for W003.
