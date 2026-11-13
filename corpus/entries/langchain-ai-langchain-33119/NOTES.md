# langchain-ai/langchain#33119

Overrides an inherited standard test in the MistralAI integration suite only to add pytest.mark.xfail(reason='MistralAI inconsistently fails to return valid fields') and call super. The inherited test can no longer fail for this provider. Weakened. Stresses R004 on an override that exists only to add xfail, the same shape as an earlier langchain entry.
