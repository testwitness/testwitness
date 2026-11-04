# aws/aws-sdk-js-v3#8212

Replaces the exact expected request path /2013-04-01/change/my-change with a regular expression that accepts any 20xx date segment. Weakened: the API version in the path is no longer pinned. Stresses A002 on exact to pattern inside a project request matcher helper, which the engine does not treat as an assertion family today.
