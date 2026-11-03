# langchain-ai/langchain#37612

Adds a new test_tool_calling override parametrised over output versions where the v1 case is marked xfail, and loosens web search assertions from set equality to per type presence. Stresses R010 on marks inside pytest.param and A002 on set equality replaced by membership checks.
