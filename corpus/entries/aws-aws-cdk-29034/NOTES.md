# aws/aws-cdk#29034

Comments out two CLI integration tests declared with the project's integTest wrapper because they were broken. The tests no longer run. Weakened. Stresses R001 on tests declared through a custom wrapper function that the TypeScript front end does not recognise as a test today.
