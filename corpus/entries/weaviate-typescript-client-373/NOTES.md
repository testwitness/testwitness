# weaviate/typescript-client#373

While adding newer server versions to the CI matrix, one integration test in the config suite becomes it.only. The other tests in the file stop running until a later PR removed the marker. Stresses R005 in a PR whose main change is a workflow.
