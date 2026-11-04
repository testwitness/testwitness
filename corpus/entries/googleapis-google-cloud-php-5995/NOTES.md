# googleapis/google-cloud-php#5995

Adds continue-on-error: true to the unit test matrix job that runs PHPUnit on every PHP version and platform, so unit test failures no longer fail the workflow. Stresses W002 on a literal true at job level for a PHP test command.
