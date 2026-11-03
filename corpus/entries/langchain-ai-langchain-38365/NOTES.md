# langchain-ai/langchain#38365

Overrides test_tool_choice to add pytest.mark.xfail(reason='Retry flaky tool choice behavior') plus a retry mark. Weakened. Stresses R004 when the override is new in the subclass.
