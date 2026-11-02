# apache/kafka#22875

Admin focused tests in KRaftClusterTest are deleted and recreated in clients-integration-tests as ClusterTest methods with new names (testCreateManyTopics, testCreateAndDeleteTopic) and the quota tests are folded into ClientQuotasRequestTest using alterEntityQuotas and verifyDescribeEntityQuotas helpers. Bodies are rewritten, so body hash matching will not find them. Honest move. A tool flagging testClientQuotas as removed would be a tolerable low confidence finding; a confident removal finding is a false positive. Stresses removal rules when the move is also a rewrite.
